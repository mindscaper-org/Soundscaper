/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { checkModuleBoundaries } from '../scripts/lib/check-module-boundary-policy.ts';
import { parseModulePolicy } from '../scripts/lib/module-policy.ts';

function fixture() {
	const snapshot = new Map([
		['src/common/foundation/value.ts', 'export interface Value { readonly value: number }'],
		['src/common/imaging/pixels.ts', "import type { Value } from '../foundation/value.ts'; export const pixels = (value: Value) => value.value;"],
		['src/common/imaging/internal/cache.ts', 'export const cache = new Map();'],
		['src/common/editor/history.ts', 'export const history = [];'],
		['src/soundscaper/app.ts', "import { pixels } from '../common/imaging/pixels.ts'; void pixels;"],
	]);
	const policy = parseModulePolicy({ schemaVersion: 1, globalInputs: [], modules: [
		{ id: 'foundation', sourcePrefixes: ['src/common/foundation/'], publicFiles: ['src/common/foundation/value.ts'], dependencies: [] },
		{ id: 'imaging', sourcePrefixes: ['src/common/imaging/'], publicFiles: ['src/common/imaging/pixels.ts'], dependencies: ['foundation'] },
		{ id: 'timeline', sourcePrefixes: ['src/common/editor/'] },
		{ id: 'soundscaper', sourcePrefixes: ['src/soundscaper/'] },
	] });
	return { snapshot, policy };
}

void test('module boundaries admit declared public type imports and existing legacy modules', () => {
	const { snapshot, policy } = fixture();
	assert.deepEqual(checkModuleBoundaries(snapshot, policy), []);
});

void test('module boundaries reject product/editor dependencies even when they are type imports', () => {
	for (const target of ['../editor/history.ts', '../../soundscaper/app.ts']) {
		const { snapshot, policy } = fixture();
		snapshot.set('src/common/imaging/pixels.ts', `import type * as Owner from '${target}'; export type Pixel = Owner;`);
		assert.match(checkModuleBoundaries(snapshot, policy).join('\n'), /undeclared dependency/u);
	}
});

void test('module boundaries reject presentation aliases and erased React types in a neutral source', () => {
	for (const target of ['react', 'react/jsx-runtime', 'electron', 'electron/main', '@audacity-ui/components', '@soundscaper/design-system/Button']) {
		const { snapshot, policy } = fixture();
		snapshot.set('src/common/imaging/pixels.ts', `export const load = () => import('${target}');`);
		assert.match(checkModuleBoundaries(snapshot, policy).join('\n'), /presentation or Electron/u);
	}
	const { snapshot, policy } = fixture();
	snapshot.set('src/common/imaging/pixels.ts', 'export type Pixel = import("react").ReactNode;');
	assert.match(checkModuleBoundaries(snapshot, policy).join('\n'), /presentation or Electron/u);
});

void test('public module inventories prevent private imports from external consumers', () => {
	const { snapshot, policy } = fixture();
	snapshot.set('src/soundscaper/app.ts', "import { cache } from '../common/imaging/internal/cache.ts'; void cache;");
	assert.match(checkModuleBoundaries(snapshot, policy).join('\n'), /private module/u);
});

void test('extracted modules reject barrels, undeclared public files, and unresolved dependencies', () => {
	const { snapshot, policy } = fixture();
	snapshot.set('src/common/imaging/pixels.ts', "export * from './internal/cache.ts'; import './missing.ts';");
	snapshot.set('src/common/imaging/forgotten.ts', 'export const forgotten = true;');
	const failures = checkModuleBoundaries(snapshot, policy).join('\n');
	assert.match(failures, /barrel/u);
	assert.match(failures, /public inventory/u);
	assert.match(failures, /unresolved/u);
});

void test('module boundary checks reject missing public files and dependencies on private files', () => {
	const { snapshot, policy } = fixture();
	snapshot.delete('src/common/foundation/value.ts');
	snapshot.set('src/common/foundation/internal/value.ts', 'export interface Value {}');
	snapshot.set('src/common/imaging/pixels.ts', "import type { Value } from '../foundation/internal/value.ts'; export type Pixel = Value;");
	const failures = checkModuleBoundaries(snapshot, policy).join('\n');
	assert.match(failures, /missing public file/u);
	assert.match(failures, /private module/u);
});

void test('extracted module cycles fail even through erased type dependencies', () => {
	const { snapshot, policy } = fixture();
	snapshot.set('src/common/imaging/pixels.ts', "import type { Other } from './internal/cache.ts'; export type Pixel = Other;");
	snapshot.set('src/common/imaging/internal/cache.ts', "import type { Pixel } from '../pixels.ts'; export type Other = Pixel;");
	assert.match(checkModuleBoundaries(snapshot, policy).join('\n'), /dependency cycle/u);
});
