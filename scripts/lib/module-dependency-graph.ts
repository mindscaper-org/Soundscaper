/* SPDX-License-Identifier: AGPL-3.0-only */

import { posix } from 'node:path';
import ts from 'typescript';
import { matchesModulePattern, normalizeModulePath, type ModuleRuntimeInput } from './module-policy.ts';

export type ModuleSnapshot = ReadonlyMap<string, string>;
export type ModuleSpecifierResolver = (specifier: string, importer: string) => string | null | undefined;

export interface ModuleGraphOptions {
	readonly resolveSpecifier?: ModuleSpecifierResolver;
	readonly runtimeInputs?: readonly ModuleRuntimeInput[];
}

export interface ModuleDependencyGraph {
	readonly dependencies: ReadonlyMap<string, ReadonlySet<string>>;
	readonly unresolved: ReadonlyMap<string, readonly string[]>;
}

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];

function moduleCandidate(snapshot: ModuleSnapshot, importer: string, specifier: string): string | undefined {
	const path = posix.normalize(posix.join(posix.dirname(importer), specifier.split(/[?#]/u)[0]!));
	if (path.startsWith('../') || path === '..') return undefined;
	const candidates = [path];
	if (/\.[cm]?jsx?$/u.test(path)) {
		for (const extension of ['.ts', '.tsx', '.mts', '.cts']) candidates.push(path.replace(/\.[cm]?jsx?$/u, extension));
	}
	// TypeScript appends source extensions to extensionless module names even
	// when a basename contains a version suffix such as tokens.v2.
	for (const extension of EXTENSIONS) candidates.push(`${path}${extension}`, `${path}/index${extension}`);
	return candidates.find(candidate => snapshot.has(candidate));
}

function kind(file: string): ts.ScriptKind {
	if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
	if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
	return /\.[cm]?js$/u.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

function declaredInputs(snapshot: ModuleSnapshot, file: string, rows: readonly ModuleRuntimeInput[]): Set<string> {
	const dependencies = new Set<string>();
	for (const input of rows) {
		if (!input.files.some(pattern => matchesModulePattern(file, pattern))) continue;
		for (const pattern of input.dependencies) {
			for (const candidate of snapshot.keys()) if (matchesModulePattern(candidate, pattern)) dependencies.add(candidate);
		}
	}
	return dependencies;
}

/** The snapshot, not the checkout filesystem, resolves both old and current imports. */
export function buildModuleGraph(snapshot: ModuleSnapshot, options: ModuleGraphOptions = {}): ModuleDependencyGraph {
	const dependencies = new Map<string, ReadonlySet<string>>();
	const unresolved = new Map<string, readonly string[]>();
	for (const [untrustedPath, content] of snapshot) {
		const file = normalizeModulePath(untrustedPath);
		const inputs = declaredInputs(snapshot, file, options.runtimeInputs ?? []);
		const direct = new Set(inputs);
		const unknown: string[] = [];
		dependencies.set(file, direct);
		if (!SOURCE_FILE.test(file)) continue;
		const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, kind(file));
		const diagnostics = (source as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
		if (diagnostics?.length) unknown.push('source syntax could not be parsed');
		const add = (specifier: string): void => {
			const substituted = options.resolveSpecifier?.(specifier, file);
			if (substituted !== undefined && substituted !== null) {
				const target = normalizeModulePath(substituted);
				if (snapshot.has(target)) direct.add(target);
				else unknown.push(`unresolved substituted import ${specifier}: ${target}`);
				return;
			}
			// External packages are governed by lockfile/toolchain inputs. A caller
			// resolves first-party aliases through the same resolver as its build.
			if (!specifier.startsWith('.')) return;
			const target = moduleCandidate(snapshot, file, specifier);
			if (target !== undefined) direct.add(target);
			else unknown.push(`unresolved relative import ${specifier}`);
		};
		const literal = (node: ts.Node | undefined): void => {
			if (node && ts.isStringLiteralLike(node)) add(node.text);
			else unknown.push('computed module dependency cannot be resolved statically');
		};
		const visit = (node: ts.Node): void => {
			if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) literal(node.moduleSpecifier);
			if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) literal(node.moduleReference.expression);
			if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) literal(node.argument.literal);
			if (ts.isCallExpression(node)) {
				const name = node.expression.getText(source);
				if (node.expression.kind === ts.SyntaxKind.ImportKeyword || ['require', 'require.resolve', 'module.require'].includes(name)) literal(node.arguments[0]);
				if (name === 'import.meta.glob') {
					const patterns = node.arguments[0];
					const values = patterns && ts.isArrayLiteralExpression(patterns) ? [...patterns.elements] : [patterns];
					for (const value of values) {
						if (!value || !ts.isStringLiteralLike(value)) { unknown.push('computed import.meta.glob cannot be resolved statically'); continue; }
						const pattern = posix.normalize(posix.join(posix.dirname(file), value.text));
						for (const candidate of snapshot.keys()) if (matchesModulePattern(candidate, pattern)) direct.add(candidate);
					}
				}
			}
			if (ts.isNewExpression(node)) {
				const name = node.expression.getText(source);
				if (name === 'URL' && node.arguments?.[1]?.getText(source) === 'import.meta.url') {
					const value = node.arguments[0];
					// A directory URL computes a location; it does not itself read
					// every file below it. Actual directory reads need runtime inputs.
					if (value && ts.isStringLiteralLike(value) && (value.text.endsWith('/') || value.text === '.' || value.text === '..')) { /* location only */ }
					else literal(value);
				}
				if (name === 'Worker' || name === 'SharedWorker') {
					const entry = node.arguments?.[0];
					const url = entry && ts.isNewExpression(entry) && entry.expression.getText(source) === 'URL';
					if (!url) literal(entry);
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
		if (unknown.length) unresolved.set(file, Object.freeze([...new Set(unknown)].sort()));
	}
	return { dependencies, unresolved };
}

export function reverseModuleClosure(graph: ModuleDependencyGraph, seeds: Iterable<string>): Set<string> {
	const reverse = new Map<string, Set<string>>();
	for (const [file, dependencies] of graph.dependencies) {
		for (const dependency of dependencies) {
			const consumers = reverse.get(dependency) ?? new Set<string>();
			consumers.add(file);
			reverse.set(dependency, consumers);
		}
	}
	const found = new Set(seeds);
	const pending = [...found];
	for (let index = 0; index < pending.length; index++) {
		for (const consumer of reverse.get(pending[index]!) ?? []) {
			if (!found.has(consumer)) { found.add(consumer); pending.push(consumer); }
		}
	}
	return found;
}

export function forwardModuleClosure(graph: ModuleDependencyGraph, seeds: Iterable<string>): Set<string> {
	const found = new Set(seeds);
	const pending = [...found];
	for (let index = 0; index < pending.length; index++) {
		for (const dependency of graph.dependencies.get(pending[index]!) ?? []) {
			if (!found.has(dependency)) { found.add(dependency); pending.push(dependency); }
		}
	}
	return found;
}
