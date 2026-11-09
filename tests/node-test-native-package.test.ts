/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';

import { collectTestDependencies, partitionNodeTestBootstrapBatches } from '../scripts/lib/node-test-bootstrap.mjs';

const PACKAGE = 'node_modules/@noble/hashes';
const METADATA = JSON.stringify({ name: '@noble/hashes', type: 'module', exports: {
	'./sha2.js': './sha2.js', './utils.js': './utils.js', './sha3.js': './sha3.js',
} });

function write(root: string, name: string, source: string): void {
	mkdirSync(dirname(join(root, name)), { recursive: true });
	writeFileSync(join(root, name), source);
}

function fixture(context: TestContext, sources: Readonly<Record<string, string>> = {}): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'soundscaper-native-package-')));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	for (const [name, source] of Object.entries({
		'package.json': '{"type":"module"}',
		'entry.ts': "import { value } from '@noble/hashes/sha2.js'; export const result: number = value;",
		[`${PACKAGE}/package.json`]: METADATA,
		[`${PACKAGE}/sha2.js`]: "export { value } from './utils.js';",
		[`${PACKAGE}/utils.js`]: 'export const value = 3;',
		...sources,
	})) write(root, name, source);
	return root;
}

function expectBootstrap(root: string, useLoaders: boolean, name = 'entry.ts'): void {
	const file = join(root, name);
	assert.deepEqual(partitionNodeTestBootstrapBatches(root, [file]), [{ files: [file], useLoaders }]);
}

test('the two supported package entries and closed relative JavaScript cycles run without hooks', context => {
	const root = fixture(context, {
		'entry.ts': "import assert from 'node:assert/strict'; import test from 'node:test'; import { value } from '@noble/hashes/sha2.js'; import { value as other } from '@noble/hashes/utils.js'; test('native package values', () => { assert.equal(value, 3); assert.equal(other, 3); });",
		[`${PACKAGE}/utils.js`]: "import './sha2.js'; export const value = 3;",
	});
	expectBootstrap(root, false);
	const result = spawnSync(process.execPath, ['--test', join(root, 'entry.ts')], { cwd: root, encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('package resolution follows the importing file and rejects a nearer incompatible package', context => {
	const root = fixture(context, {
		'nested/entry.ts': "import { value } from '@noble/hashes/sha2.js'; export const result = value;",
		[`nested/${PACKAGE}/package.json`]: '{"name":"@noble/hashes","type":"commonjs","exports":{"./sha2.js":"./sha2.js"}}',
		[`nested/${PACKAGE}/sha2.js`]: 'exports.value = 4;',
	});
	expectBootstrap(root, false);
	expectBootstrap(root, true, 'nested/entry.ts');
});

test('symlinked importers retain hooks when their real location selects another package', context => {
	const root = fixture(context);
	const external = fixture(context, { [`${PACKAGE}/utils.js`]: 'export const value = 4;' });
	symlinkSync(external, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
	const file = join(root, 'linked/entry.ts');
	const result = spawnSync(process.execPath, ['--input-type=module', '--eval',
		'console.log((await import(process.argv[1])).result)', pathToFileURL(file).href], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.equal(result.stdout.trim(), '4');
	expectBootstrap(root, true, 'linked/entry.ts');
});

test('unknown package entries and conditional or incompatible metadata retain hooks', context => {
	for (const metadata of [
		{ name: '@noble/hashes', type: 'commonjs', exports: { './sha2.js': './sha2.js' } },
		{ name: 'another-package', type: 'module', exports: { './sha2.js': './sha2.js' } },
		{ name: '@noble/hashes', type: 'module', exports: { './sha2.js': { import: './sha2.js', require: './utils.js' } } },
		{ name: '@noble/hashes', type: 'module', exports: { './sha2.js': './typed.ts' } },
	]) {
		const root = fixture(context, { [`${PACKAGE}/package.json`]: JSON.stringify(metadata), [`${PACKAGE}/typed.ts`]: 'export const value: number = 3;' });
		expectBootstrap(root, true);
	}
	const root = fixture(context, {
		'entry.ts': "import { value } from '@noble/hashes/sha3.js'; export const result = value;",
		[`${PACKAGE}/sha3.js`]: 'export const value = 3;',
	});
	expectBootstrap(root, true);
});

test('package graphs retain hooks for transforms, assets, packages, interpreters and computed imports', context => {
	for (const source of [
		"import './typed.ts'; export const value = 3;",
		"import './style.css'; export const value = 3;",
		"import 'other-package'; export const value = 3;",
		"import '.external.js'; export const value = 3;",
		"import { Worker } from 'node:worker_threads'; export const value = Worker;",
		"const file = './utils.js'; export const value = import(file);",
		"export const value = eval('3');",
		"export const value = Function('return 3')();",
		"export const value = process.getBuiltinModule('fs');",
		'export const value: number = 3;',
		'export const value = <div />;',
		'export const value = ;',
	]) {
		const root = fixture(context, {
			[`${PACKAGE}/sha2.js`]: source,
			[`${PACKAGE}/typed.ts`]: 'export const typed: number = 3;',
			[`${PACKAGE}/style.css`]: 'body {}',
			[`${PACKAGE}/.external.js`]: 'export const value = 3;',
		});
		expectBootstrap(root, true);
	}
});

test('relative paths and symlinks cannot escape the admitted package graph', context => {
	const root = fixture(context, {
		[`${PACKAGE}/sha2.js`]: "export { value } from '../outside.js';",
		'node_modules/@noble/outside.js': 'export const value = 3;',
		'external/value.js': 'export const value = 3;',
	});
	expectBootstrap(root, true);
	write(root, `${PACKAGE}/sha2.js`, "export { value } from './linked/value.js';");
	symlinkSync(join(root, 'external'), join(root, PACKAGE, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
	expectBootstrap(root, true);
});

test('new invocations revalidate edited package sources and export metadata', context => {
	const root = fixture(context);
	expectBootstrap(root, false);
	write(root, `${PACKAGE}/utils.js`, "import './style.css'; export const value = 3;");
	write(root, `${PACKAGE}/style.css`, 'body {}');
	expectBootstrap(root, true);
	write(root, `${PACKAGE}/utils.js`, 'export const value = 3;');
	expectBootstrap(root, false);
	write(root, `${PACKAGE}/package.json`, METADATA.replace('"module"', '"commonjs"'));
	expectBootstrap(root, true);
});

test('package admission preserves local TypeScript compatibility and prerequisite boundaries', context => {
	const root = fixture(context, {
		'entry.ts': "import { value } from '@noble/hashes/sha2.js'; import './local.ts'; export const result = value;",
		'local.ts': 'export enum Mode { First }',
	});
	expectBootstrap(root, true);
	assert.deepEqual([...collectTestDependencies(root, [join(root, 'entry.ts')])], [join(root, 'entry.ts'), join(root, 'local.ts')]);
});
