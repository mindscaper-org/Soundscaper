/* SPDX-License-Identifier: AGPL-3.0-only */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import ts from 'typescript';

const NATIVE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
// These APIs can start another module graph or interpreter outside static imports.
const MODULE_LAUNCHERS = new Set(['child_process', 'worker_threads', 'module', 'vm']);

function inside(directory, file) {
	const path = relative(directory, file);
	return path !== '..' && !path.startsWith('../') && !isAbsolute(path);
}

function dependencyReader(repositoryRoot) {
	const root = resolve(repositoryRoot);
	const records = new Map();
	return file => {
		file = resolve(file);
		if (records.has(file)) return records.get(file);
		const record = { native: inside(root, file) && NATIVE_EXTENSIONS.has(extname(file)), dependencies: [], error: null };
		records.set(file, record);
		let source;
		try { source = readFileSync(file, 'utf8'); }
		catch (error) { record.native = false; record.error = error; return record; }
		const kind = /\.tsx$/u.test(file) ? ts.ScriptKind.TSX : /\.jsx$/u.test(file) ? ts.ScriptKind.JSX
			: /\.[cm]?ts$/u.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
		const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
		if (syntax.parseDiagnostics.length) record.native = false;
		const specifier = value => {
			if (!value || !ts.isStringLiteralLike(value)) { record.native = false; return; }
			const id = value.text;
			if (isBuiltin(id)) {
				if (MODULE_LAUNCHERS.has(id.replace(/^node:/u, ''))) record.native = false;
				return;
			}
			if (!id.startsWith('.')) { record.native = false; return; }
			const target = resolve(dirname(file), id);
			if (!inside(root, target) || !existsSync(target) || !statSync(target).isFile()) {
				record.native = false;
				return;
			}
			record.dependencies.push(target);
		};
		const visit = node => {
			if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) return;
			if (ts.isExportDeclaration(node) && node.isTypeOnly) return;
			if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
				specifier(node.moduleSpecifier);
			} else if (ts.isCallExpression(node)) {
				const name = node.expression.getText(syntax);
				if (node.expression.kind === ts.SyntaxKind.ImportKeyword || name === 'require') specifier(node.arguments[0]);
				else if (['eval', 'Function', 'process.getBuiltinModule'].includes(name)) record.native = false;
			} else if (ts.isNewExpression(node) && node.expression.getText(syntax) === 'Function') record.native = false;
			if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) record.native = false;
			ts.forEachChild(node, visit);
		};
		visit(syntax);
		return record;
	};
}

/** Capture one invocation's dependency evidence; later calls read changed sources afresh. */
export function collectTestDependencies(repositoryRoot, testFiles, { testHelpersOnly = false } = {}) {
	const read = dependencyReader(repositoryRoot);
	const tests = resolve(repositoryRoot, 'tests');
	const files = new Set();
	const visit = file => {
		file = resolve(file);
		if (files.has(file) || (testHelpersOnly && !inside(tests, file))) return;
		files.add(file);
		const record = read(file);
		if (record.error) throw record.error;
		for (const dependency of record.dependencies) visit(dependency);
	};
	for (const file of testFiles) visit(file);
	return files;
}

/** Only closed JS graphs omit hooks; unknown imports and child interpreters keep them. */
export function partitionNodeTestBootstrapBatches(repositoryRoot, testFiles) {
	const read = dependencyReader(repositoryRoot);
	const native = [], loaders = [];
	for (const file of testFiles) {
		const visited = new Set();
		const closed = candidate => {
			if (!NATIVE_EXTENSIONS.has(extname(candidate))) return false;
			if (visited.has(candidate)) return true;
			visited.add(candidate);
			const record = read(candidate);
			return record.native && record.dependencies.every(closed);
		};
		(closed(file) ? native : loaders).push(file);
	}
	return [{ files: native, useLoaders: false }, { files: loaders, useLoaders: true }]
		.filter(batch => batch.files.length > 0);
}
