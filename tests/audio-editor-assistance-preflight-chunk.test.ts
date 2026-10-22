/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import {
	EAGER_CHUNK_GROUPS,
	resolveRelativeModule,
} from './helpers/eager-chunk-group-crossings.ts';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const PREFLIGHT_OWNER = 'editor-assistance-model-preflight';
const PREFLIGHT_MODULES = [
	'src/common/editor/assistance/workflow-recipes.ts',
	'src/common/editor/assistance/workflow-settings-v1.ts',
	'src/common/editor/controller/assistance/local-assistance-task-models.ts',
	'src/common/editor/controller/assistance/internal/guided/local-assistance-guided-model-selection.ts',
	'src/common/editor/controller/assistance/internal/guided/local-assistance-guided-stage-selection.ts',
	'src/common/editor/ui/local-model-manager-bridge.ts',
	'src/common/editor/ui/local-model-manager-store.ts',
	'src/common/editor/ui/local-model-bytes.ts',
] as const;

test('model preflight has a narrow lazy owner independent of the inference and optional surface chunks', () => {
	for (const path of PREFLIGHT_MODULES) {
		assert.equal(chunkGroupForModulePath(path), PREFLIGHT_OWNER, path);
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), PREFLIGHT_OWNER, path);
	}
	assert.equal(EAGER_CHUNK_GROUPS.has(PREFLIGHT_OWNER), false);
	assert.equal(chunkGroupForModulePath('src/common/editor/ui/dialogs/AssistanceLoadingDialog.tsx'), 'editor-shell');
	assert.equal(chunkGroupForModulePath('src/common/editor/controller/assistance/internal/local-assistance-runtime.ts'),
		'editor-optional-assistance');
	assert.equal(chunkGroupForModulePath('src/common/editor/ui/local-assistance-guided-session-store.ts'),
		'editor-optional-surfaces');
	const group = chunkGroups.find(({ name }) => name === PREFLIGHT_OWNER);
	assert.ok(group);
	assert.equal(group.minSize, 0);
	assert.equal(group.includeDependenciesRecursively, false);
	assert.ok(typeof group.maxSize === 'number' && group.maxSize <= 500_000);
});

test('assistance loading styles share the shell fallback without claiming the model runtime', () => {
	const path = 'src/common/editor/ui/dialogs/AssistanceModelGate.css';
	for (const variant of [path, path.replaceAll('/', '\\')]) {
		assert.equal(chunkGroupForModulePath(variant), 'editor-shell', variant);
	}
	const loading = readFileSync(new URL('../src/common/editor/ui/dialogs/AssistanceLoadingDialog.tsx', import.meta.url), 'utf8');
	assert.match(loading, /^import '\.\/AssistanceModelGate\.css';$/mu);
	const styles = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
	assert.doesNotMatch(styles, /@import\b|url\s*\(/u);
	for (const name of ['AssistanceModelGate.tsx', 'AssistanceModelGateExtra.css',
		'LocalAssistanceDialogSurface.tsx', 'LocalAssistanceRuntimeDialog.tsx']) {
		const owner = chunkGroupForModulePath(`src/common/editor/ui/dialogs/${name}`);
		assert.equal(EAGER_CHUNK_GROUPS.has(owner ?? ''), false, name);
	}
	const group = chunkGroups.find(({ name }) => name === 'editor-shell');
	assert.ok(group);
	assert.equal(group.includeDependenciesRecursively, false);
	assert.equal(group.maxSize, 400_000);
});

test('preflight helpers never statically import processing implementation owners', () => {
	assert.deepEqual(processingDependencies(PREFLIGHT_MODULES), []);
});

test('the menu-requested model preflight surface never statically imports processing owners', () => {
	assert.deepEqual(processingDependencies([
		'src/common/editor/ui/dialogs/LocalAssistanceDialogSurface.tsx',
	]), []);
});

function processingDependencies(entryModules: readonly string[]): readonly string[] {
	const pending = entryModules.map((path) => resolve(REPOSITORY_ROOT, path));
	const visited = new Set<string>();
	const crossings: string[] = [];
	while (pending.length > 0) {
		const current = pending.pop()!;
		if (visited.has(current)) continue;
		visited.add(current);
		for (const specifier of runtimeImports(current)) {
			const target = resolveRelativeModule(current, specifier);
			if (!target) continue;
			const path = relative(REPOSITORY_ROOT, target).replaceAll('\\', '/');
			const owner: unknown = chunkGroupForModulePath(path);
			if (typeof owner === 'string' && EAGER_CHUNK_GROUPS.has(owner)) continue;
			if (owner === 'editor-optional-assistance' || owner === 'editor-optional-surfaces') {
				crossings.push(path);
			} else pending.push(target);
		}
	}
	return [...new Set(crossings)].sort();
}

function runtimeImports(path: string): readonly string[] {
	const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest);
	return source.statements.flatMap((statement) => {
		if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) return [];
		if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
		if (ts.isImportDeclaration(statement)) {
			const clause = statement.importClause;
			if (clause?.isTypeOnly) return [];
			if (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
				&& clause.namedBindings.elements.length > 0
				&& clause.namedBindings.elements.every((name) => name.isTypeOnly)) return [];
		} else {
			if (statement.isTypeOnly) return [];
			if (statement.exportClause && ts.isNamedExports(statement.exportClause)
				&& statement.exportClause.elements.length > 0
				&& statement.exportClause.elements.every((name) => name.isTypeOnly)) return [];
		}
		return statement.moduleSpecifier.text.startsWith('.') ? [statement.moduleSpecifier.text] : [];
	});
}
