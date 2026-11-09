/* SPDX-License-Identifier: AGPL-3.0-only */

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire, findPackageJSON, isBuiltin, stripTypeScriptTypes } from 'node:module';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { transformSync } from 'esbuild';
import ts from 'typescript';

const NATIVE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts']);
// These APIs can start another module graph or interpreter outside static imports.
const MODULE_LAUNCHERS = new Set(['child_process', 'worker_threads', 'module', 'vm']);
const NATIVE_PACKAGE = '@noble/hashes';
const NATIVE_PACKAGE_IMPORTS = new Set([`${NATIVE_PACKAGE}/sha2.js`, `${NATIVE_PACKAGE}/utils.js`]);

function inside(directory, file) {
	const path = relative(directory, file);
	return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function nativePackageReader() {
	const entries = new Map();
	const records = new Map();
	return (id, importer) => {
		if (!NATIVE_PACKAGE_IMPORTS.has(id)) return false;
		try {
			if (realpathSync(importer) !== importer) return false;
			const metadataFile = findPackageJSON(id, importer);
			if (!metadataFile) return false;
			const key = `${metadataFile}\0${id}`;
			if (entries.has(key)) return entries.get(key);
			entries.set(key, false);
			const metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
			const target = metadata.exports?.[`.${id.slice(NATIVE_PACKAGE.length)}`];
			if (metadata.name !== NATIVE_PACKAGE || metadata.type !== 'module' || typeof target !== 'string'
				|| !target.startsWith('./') || extname(target) !== '.js') return false;
			const directory = realpathSync(dirname(metadataFile));
			const entry = realpathSync(createRequire(importer).resolve(id));
			if (!inside(directory, entry) || realpathSync(resolve(directory, target)) !== entry) return false;
			const seen = new Set();
			const closed = candidate => {
				const file = realpathSync(candidate);
				if (!inside(directory, file) || extname(file) !== '.js' || !statSync(file).isFile()) return false;
				if (seen.has(file)) return true;
				seen.add(file);
				if (!records.has(file)) {
					for (let parent = dirname(file); parent !== directory; parent = dirname(parent)) {
						if (existsSync(join(parent, 'package.json'))) return false;
					}
					const source = readFileSync(file, 'utf8');
					// The JS parser rejects TypeScript and JSX hidden behind a .js export.
					transformSync(source, { loader: 'js' });
					const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
					const record = { supported: syntax.parseDiagnostics.length === 0, dependencies: [] };
					records.set(file, record);
					const specifier = value => {
						if (!value || !ts.isStringLiteralLike(value) || !/^\.\.?\//u.test(value.text)) record.supported = false;
						else record.dependencies.push(resolve(dirname(file), value.text));
					};
					const visit = node => {
						if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) specifier(node.moduleSpecifier);
						else if (ts.isCallExpression(node)) {
							const name = node.expression.getText(syntax);
							if (node.expression.kind === ts.SyntaxKind.ImportKeyword) specifier(node.arguments[0]);
							else if (['require', 'eval', 'Function', 'process.getBuiltinModule'].includes(name)) record.supported = false;
						} else if (ts.isNewExpression(node) && node.expression.getText(syntax) === 'Function') record.supported = false;
						if (ts.isDecorator(node)) record.supported = false;
						ts.forEachChild(node, visit);
					};
					visit(syntax);
				}
				const record = records.get(file);
				return record.supported && record.dependencies.every(closed);
			};
			const admitted = closed(entry);
			entries.set(key, admitted);
			return admitted;
		} catch {
			return false;
		}
	};
}

function runtimeModuleSurface(source) {
	const syntax = ts.createSourceFile('runtime.js', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
	return JSON.stringify(syntax.statements.flatMap(node => {
		if (ts.isImportDeclaration(node)) return [{ kind: 'import', module: node.moduleSpecifier.text,
			name: node.importClause?.name?.text ?? null,
			bindings: node.importClause?.namedBindings ? ts.isNamespaceImport(node.importClause.namedBindings)
				? node.importClause.namedBindings.name.text
				: node.importClause.namedBindings.elements.map(value => [value.propertyName?.text ?? value.name.text, value.name.text]) : null }];
		if (ts.isExportDeclaration(node)) {
			if (!node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length === 0) return [];
			return [{ kind: 'export', module: node.moduleSpecifier?.text ?? null,
				bindings: node.exportClause ? ts.isNamespaceExport(node.exportClause) ? node.exportClause.name.text
					: node.exportClause.elements.map(value => [value.propertyName?.text ?? value.name.text, value.name.text]) : '*' }];
		}
		if (ts.isExportAssignment(node)) return [{ kind: 'default', value: node.expression.getText(syntax) }];
		return [];
	}));
}

function rootTypeScriptOptions(root) {
	const file = join(root, 'tsconfig.json');
	if (!existsSync(file)) return { useDefineForClassFields: true, verbatimModuleSyntax: false };
	const config = ts.readConfigFile(file, ts.sys.readFile);
	if (config.error) return null;
	// Read inherited compiler options without enumerating the project's source files.
	const { options } = ts.parseJsonConfigFileContent({ ...config.config, files: [], include: [] },
		{ ...ts.sys, readDirectory: () => [] }, root);
	return {
		useDefineForClassFields: options.useDefineForClassFields ?? (options.target ?? ts.ScriptTarget.ESNext) >= ts.ScriptTarget.ES2022,
		verbatimModuleSyntax: options.verbatimModuleSyntax ?? false,
	};
}

function compatibleNativeTypeScript(source, options) {
	if (!options) return false;
	try {
		const stripped = stripTypeScriptTypes(source);
		// Preserve ESM declaration forms so format lowering cannot mask elision.
		const transformed = transformSync(source, { loader: 'ts', tsconfigRaw: { compilerOptions: options } }).code;
		return runtimeModuleSurface(stripped) === runtimeModuleSurface(transformed);
	} catch {
		return false;
	}
}

function dependencyReader(repositoryRoot, { nativePackages = false } = {}) {
	const root = resolve(repositoryRoot);
	const records = new Map();
	const moduleDirectories = new Map();
	const rootConfigDirectories = new Map();
	const nativePackage = nativePackages ? nativePackageReader() : () => false;
	let options;
	const moduleDirectory = directory => {
		if (!inside(root, directory)) return false;
		if (moduleDirectories.has(directory)) return moduleDirectories.get(directory);
		let admitted = false;
		if (existsSync(join(directory, 'package.json'))) {
			try { admitted = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).type === 'module'; }
			catch { admitted = false; }
		} else if (directory !== root) admitted = moduleDirectory(dirname(directory));
		moduleDirectories.set(directory, admitted);
		return admitted;
	};
	const rootConfiguredDirectory = directory => {
		if (!inside(root, directory)) return false;
		if (directory === root) return true;
		if (rootConfigDirectories.has(directory)) return rootConfigDirectories.get(directory);
		const admitted = !existsSync(join(directory, 'tsconfig.json')) && rootConfiguredDirectory(dirname(directory));
		rootConfigDirectories.set(directory, admitted);
		return admitted;
	};
	return file => {
		file = resolve(file);
		if (records.has(file)) return records.get(file);
		const typed = extname(file) === '.ts';
		const record = { native: inside(root, file) && NATIVE_EXTENSIONS.has(extname(file)), dependencies: [], error: null, validate: () => true };
		if (typed && record.native && (process.features.typescript !== 'strip' || process.env.TSX_TSCONFIG_PATH !== undefined
			|| file.split(/[\\/]/u).includes('node_modules') || !moduleDirectory(dirname(file)) || !rootConfiguredDirectory(dirname(file)))) record.native = false;
		records.set(file, record);
		let source;
		try { source = readFileSync(file, 'utf8'); }
		catch (error) { record.native = false; record.error = error; return record; }
		const kind = /\.tsx$/u.test(file) ? ts.ScriptKind.TSX : /\.jsx$/u.test(file) ? ts.ScriptKind.JSX
			: /\.[cm]?ts$/u.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
		const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
		if (syntax.parseDiagnostics.length) record.native = false;
		let classFields = false;
		const specifier = value => {
			if (!value || !ts.isStringLiteralLike(value)) { record.native = false; return; }
			const id = value.text;
			if (isBuiltin(id)) {
				if (MODULE_LAUNCHERS.has(id.replace(/^node:/u, ''))) record.native = false;
				return;
			}
			if (!id.startsWith('.')) { if (!nativePackage(id, file)) record.native = false; return; }
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
			if (ts.isDecorator(node)) record.native = false;
			if (ts.isPropertyDeclaration(node)) classFields = true;
			ts.forEachChild(node, visit);
		};
		visit(syntax);
		if (typed) {
			let checked = false;
			record.validate = () => {
				if (!checked) {
					checked = true;
					if (options === undefined) options = rootTypeScriptOptions(root);
					record.native = record.native && (!classFields || options?.useDefineForClassFields === true)
						&& compatibleNativeTypeScript(source, options);
				}
				return record.native;
			};
		}
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

/** Closed JS and compatible erasable TS graphs omit hooks; unknown graphs keep them. */
export function partitionNodeTestBootstrapBatches(repositoryRoot, testFiles) {
	const read = dependencyReader(repositoryRoot, { nativePackages: true });
	const native = [], loaders = [];
	for (const file of testFiles) {
		const visited = new Set();
		const closed = candidate => {
			if (!NATIVE_EXTENSIONS.has(extname(candidate))) return false;
			if (visited.has(candidate)) return true;
			visited.add(candidate);
			const record = read(candidate);
			return record.native && record.dependencies.every(closed) && record.validate();
		};
		(closed(file) ? native : loaders).push(file);
	}
	return [{ files: native, useLoaders: false }, { files: loaders, useLoaders: true }]
		.filter(batch => batch.files.length > 0);
}
