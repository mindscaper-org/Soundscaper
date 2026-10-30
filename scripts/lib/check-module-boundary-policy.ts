/* SPDX-License-Identifier: AGPL-3.0-only */

import ts from 'typescript';
import { buildModuleGraph, type ModuleSnapshot } from './module-dependency-graph.ts';
import { ownerOfModulePath, type ModuleDefinition, type ModulePolicy } from './module-policy.ts';

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const FORBIDDEN_EXTERNAL = /^(?:react(?:-dom)?|electron|@audacity-ui\/[^/]+|@soundscaper\/design-system)(?:\/|$)/u;

function extracted(module: ModuleDefinition | undefined): module is ModuleDefinition & { readonly publicFiles: readonly string[]; readonly dependencies: readonly string[] } {
	return module?.publicFiles !== undefined && module.dependencies !== undefined;
}

function externalAndBarrelFindings(file: string, content: string): string[] {
	const failures: string[] = [];
	const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
	const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, kind);
	const check = (value: ts.Node | undefined): void => {
		if (value && ts.isStringLiteralLike(value) && FORBIDDEN_EXTERNAL.test(value.text)) {
			failures.push(`${file} imports presentation or Electron code: ${value.text}.`);
		}
	};
	const visit = (node: ts.Node): void => {
		if (ts.isImportDeclaration(node)) check(node.moduleSpecifier);
		if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
			check(node.moduleSpecifier);
			failures.push(`${file} is a barrel; extracted modules expose their owning file directly.`);
		}
		if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) check(node.moduleReference.expression);
		if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) check(node.argument.literal);
		if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require')) check(node.arguments[0]);
		ts.forEachChild(node, visit);
	};
	visit(source);
	return failures;
}

function cycleFindings(dependencies: ReadonlyMap<string, ReadonlySet<string>>, files: ReadonlySet<string>): string[] {
	const failures = new Set<string>();
	const visited = new Set<string>();
	const active = new Set<string>();
	const chain: string[] = [];
	const visit = (file: string): void => {
		if (active.has(file)) {
			const cycle = [...chain.slice(chain.indexOf(file)), file];
			failures.add(`Extracted module dependency cycle: ${cycle.join(' -> ')}.`);
			return;
		}
		if (visited.has(file)) return;
		visited.add(file);
		active.add(file);
		chain.push(file);
		for (const dependency of dependencies.get(file) ?? []) if (files.has(dependency)) visit(dependency);
		chain.pop();
		active.delete(file);
	};
	for (const file of [...files].sort()) visit(file);
	return [...failures];
}

/** Check neutral ownership against the same parsed imports used for test selection. */
export function checkModuleBoundaries(snapshot: ModuleSnapshot, policy: ModulePolicy): readonly string[] {
	const failures: string[] = [];
	const graph = buildModuleGraph(snapshot);
	const extractedFiles = new Set<string>();
	for (const module of policy.modules) {
		if ((module.publicFiles !== undefined) !== (module.dependencies !== undefined)) {
			failures.push(`${module.id} must declare both publicFiles and dependencies to enforce its boundary.`);
		}
		if (!extracted(module)) continue;
		for (const file of module.publicFiles) {
			if (!snapshot.has(file)) failures.push(`${module.id} has a missing public file: ${file}.`);
			if (ownerOfModulePath(policy, file)?.id !== module.id) failures.push(`${module.id} lists another owner's public file: ${file}.`);
		}
	}
	for (const [file, content] of snapshot) {
		if (!SOURCE_FILE.test(file)) continue;
		const owner = ownerOfModulePath(policy, file);
		if (extracted(owner)) {
			extractedFiles.add(file);
			if (!owner.publicFiles.includes(file) && !file.includes('/internal/')) {
				failures.push(`${file} must appear in ${owner.id}'s public inventory or live under internal/.`);
			}
			failures.push(...externalAndBarrelFindings(file, content));
			for (const unresolved of graph.unresolved.get(file) ?? []) failures.push(`${file}: ${unresolved}.`);
		}
		for (const dependency of graph.dependencies.get(file) ?? []) {
			const target = ownerOfModulePath(policy, dependency);
			if (extracted(target) && target.id !== owner?.id && !target.publicFiles.includes(dependency)) {
				failures.push(`${file} imports private module ${dependency}.`);
			}
			if (extracted(owner) && target?.id !== owner.id && (!target || !owner.dependencies.includes(target.id))) {
				failures.push(`${file} has an undeclared dependency on ${dependency}${target ? ` (${target.id})` : ''}.`);
			}
		}
	}
	failures.push(...cycleFindings(graph.dependencies, extractedFiles));
	return Object.freeze([...new Set(failures)].sort());
}
