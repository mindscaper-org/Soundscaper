/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { partitionNodeTestBootstrapBatches } from '../scripts/lib/node-test-bootstrap.mjs';

function fixture(context: TestContext, sources: Readonly<Record<string, string>>): string {
	const root = mkdtempSync(join(tmpdir(), 'soundscaper-native-typescript-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	for (const [file, source] of Object.entries({ 'package.json': '{"type":"module"}', ...sources })) {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(join(root, file), source);
	}
	return root;
}

test('closed erasable TypeScript and mixed JS cycles execute without transform hooks', context => {
	const root = fixture(context, {
		'tests/typed.test.ts': "import test from 'node:test'; import assert from 'node:assert/strict'; import { value, type Shape } from '../src/value.ts'; const shape: Shape = { value }; test('typed', () => assert.equal(shape.value, 3));",
		'tests/mixed.test.js': "import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from '../src/value.ts'; test('mixed', () => assert.equal(value, 3));",
		'src/value.ts': "import './cycle.ts'; export interface Shape { value: number } export const value: number = 3;",
		'src/cycle.ts': "import './value.ts'; import type { Unavailable } from 'type-only-package'; export type Alias = Unavailable;",
	});
	const files = ['typed.test.ts', 'mixed.test.js'].map(name => join(root, 'tests', name));
	assert.deepEqual(partitionNodeTestBootstrapBatches(root, files), [{ files, useLoaders: false }]);
	const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('TypeScript import and export elision differences retain transform hooks', context => {
	const sources = [
		"import { Shape } from './dependency.ts'; const shape: Shape = {}; export const value = shape;",
		"import { value } from './dependency.ts'; export const other = 1;",
		"import { value } from './dependency.ts'; export function read(value: number) { return value; }",
		"export { type Shape } from './dependency.ts';",
		"import { type Shape } from './dependency.ts'; export const value = 1;",
		'type Shape = {}; export default Shape;',
	];
	for (const [index, source] of sources.entries()) {
		const root = fixture(context, { 'entry.ts': source, 'dependency.ts': 'export interface Shape {} export const value = 3;' });
		const file = join(root, 'entry.ts');
		assert.deepEqual(partitionNodeTestBootstrapBatches(root, [file]), [{ files: [file], useLoaders: true }], `elision ${index}`);
	}
});

test('non-erasable syntax and transitive asset or interpreter dependencies retain hooks', context => {
	for (const source of [
		'export enum Mode { First }',
		'namespace Runtime { export const value = 1; }',
		'export class Value { constructor(public value: number) {} }',
		"import fs = require('node:fs'); export const value = fs;",
		'@decorate export class Value {}',
		"import './style.css'; export const value: number = 1;",
		"import { Worker } from 'node:worker_threads'; export const value = Worker;",
		"const id = './dependency.ts'; export const value = import(id);",
	]) {
		const root = fixture(context, { 'entry.ts': "import './dependency.ts';", 'dependency.ts': source, 'style.css': 'body {}' });
		const file = join(root, 'entry.ts');
		assert.deepEqual(partitionNodeTestBootstrapBatches(root, [file]), [{ files: [file], useLoaders: true }], source);
	}
});

test('later invocations reclassify edited TypeScript dependencies instead of reusing stale admission', context => {
	const root = fixture(context, { 'entry.ts': "import './dependency.ts';", 'dependency.ts': 'export const value: number = 3;' });
	const file = join(root, 'entry.ts');
	assert.deepEqual(partitionNodeTestBootstrapBatches(root, [file]), [{ files: [file], useLoaders: false }]);
	writeFileSync(join(root, 'dependency.ts'), 'export enum Mode { First }');
	assert.deepEqual(partitionNodeTestBootstrapBatches(root, [file]), [{ files: [file], useLoaders: true }]);
});

test('CommonJS packages, node_modules TypeScript and alternate typed extensions retain hooks', context => {
	for (const [name, sources] of [
		['entry.cts', { 'entry.cts': 'export const value: number = 3;' }],
		['entry.mts', { 'entry.mts': 'export const value: number = 3;' }],
		['nested/entry.ts', { 'nested/package.json': '{"type":"commonjs"}', 'nested/entry.ts': 'export const value: number = 3;' }],
		['node_modules/fixture/entry.ts', { 'node_modules/fixture/entry.ts': 'export const value: number = 3;' }],
	] as const) {
		const root = fixture(context, sources);
		const file = join(root, name);
		assert.deepEqual(partitionNodeTestBootstrapBatches(root, [file]), [{ files: [file], useLoaders: true }], name);
	}
});

test('ancestor TypeScript configs retain hooks across nearer module package boundaries', context => {
	const root = fixture(context, {
		'tsconfig.json': '{"compilerOptions":{"target":"ES2022"}}',
		'nested/tsconfig.json': '{"compilerOptions":{"useDefineForClassFields":false}}',
		'nested/pkg/package.json': '{"type":"module"}',
		'nested/pkg/entry.ts': 'export class Example { value: number; }',
	});
	const file = join(root, 'nested/pkg/entry.ts');
	assert.deepEqual(partitionNodeTestBootstrapBatches(root, [file]), [{ files: [file], useLoaders: true }]);
});

test('TypeScript entry points outside the repository retain hooks without following outside ancestors', context => {
	const root = fixture(context, {});
	const external = mkdtempSync(join(tmpdir(), 'soundscaper-external-typescript-'));
	context.after(() => rmSync(external, { recursive: true, force: true }));
	const file = join(external, 'entry.ts');
	writeFileSync(file, 'export const value: number = 3;');
	assert.deepEqual(partitionNodeTestBootstrapBatches(root, [file]), [{ files: [file], useLoaders: true }]);
});

test('custom TSX config overrides retain hooks even for closed erasable TypeScript', context => {
	const root = fixture(context, { 'entry.ts': 'export const value: number = 3;', 'custom.json': '{}' });
	const file = join(root, 'entry.ts');
	const module = new URL('../scripts/lib/node-test-bootstrap.mjs', import.meta.url).href;
	const source = `import { partitionNodeTestBootstrapBatches } from ${JSON.stringify(module)};
console.log(JSON.stringify(partitionNodeTestBootstrapBatches(process.argv[1], [process.argv[2]])));`;
	const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source, root, file], {
		encoding: 'utf8', env: { ...process.env, TSX_TSCONFIG_PATH: join(root, 'custom.json') },
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.deepEqual(JSON.parse(result.stdout), [{ files: [file], useLoaders: true }]);
});

test('native class fields match the configured TSX semantics and legacy fields retain hooks', context => {
	const root = fixture(context, {
		'tsconfig.json': '{"compilerOptions":{"target":"ES2022"}}',
		'entry.ts': "class Example { value: number; } console.log(Object.hasOwn(new Example(), 'value'));",
	});
	const file = join(root, 'entry.ts');
	assert.deepEqual(partitionNodeTestBootstrapBatches(root, [file]), [{ files: [file], useLoaders: false }]);
	for (const args of [[file], ['--import', import.meta.resolve('tsx'), file]]) {
		const result = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: root });
		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.equal(result.stdout.trim(), 'true');
	}
	writeFileSync(join(root, 'tsconfig.json'), '{"compilerOptions":{"target":"ES2022","useDefineForClassFields":false}}');
	assert.deepEqual(partitionNodeTestBootstrapBatches(root, [file]), [{ files: [file], useLoaders: true }]);
});

test('prerequisite discovery does not invoke native stripping or transforms when stripping is enabled', context => {
	const root = fixture(context, { 'entry.ts': "import './dependency.ts';", 'dependency.ts': 'export enum Mode { First }' });
	const module = new URL('../scripts/lib/node-test-bootstrap.mjs', import.meta.url).href;
	const source = `import { collectTestDependencies } from ${JSON.stringify(module)};
const warnings = []; process.on('warning', value => warnings.push(value.message));
const files = [...collectTestDependencies(process.argv[1], [process.argv[2]])];
setImmediate(() => console.log(JSON.stringify({ files, warnings, feature: process.features.typescript })));`;
	const file = join(root, 'entry.ts');
	const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source, root, file], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const report = JSON.parse(result.stdout) as { files: string[]; warnings: string[]; feature: unknown };
	assert.deepEqual(report.files, [file, join(root, 'dependency.ts')]);
	assert.deepEqual(report.warnings, []);
	assert.equal(report.feature, 'strip');
});

test('disabled native type stripping keeps TypeScript hooks and prerequisite discovery stays parse-only', context => {
	const root = fixture(context, { 'entry.ts': "import './dependency.ts';", 'dependency.ts': 'export enum Mode { First }' });
	const module = new URL('../scripts/lib/node-test-bootstrap.mjs', import.meta.url).href;
	const source = `import { collectTestDependencies, partitionNodeTestBootstrapBatches } from ${JSON.stringify(module)};
const warnings = []; process.on('warning', value => warnings.push(value.message));
const root = process.argv[1], file = process.argv[2];
const files = [...collectTestDependencies(root, [file])];
const batches = partitionNodeTestBootstrapBatches(root, [file]);
setImmediate(() => console.log(JSON.stringify({ files, batches, warnings, feature: process.features.typescript })));`;
	const file = join(root, 'entry.ts');
	const result = spawnSync(process.execPath, ['--no-strip-types', '--input-type=module', '--eval', source, root, file], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const report = JSON.parse(result.stdout) as { files: string[]; batches: unknown; warnings: string[]; feature: unknown };
	assert.deepEqual(report.files, [file, join(root, 'dependency.ts')]);
	assert.deepEqual(report.batches, [{ files: [file], useLoaders: true }]);
	assert.deepEqual(report.warnings, []);
	assert.equal(report.feature, false);
});
