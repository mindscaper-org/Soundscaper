/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { physicalEsbuildInputPaths } from './helpers/esbuild-metafile-inputs.ts';

test('actual attributed JSON compiler inputs retain their physical byte file and ordinary module copies', async context => {
	const root = await mkdtemp(join(tmpdir(), 'esbuild-physical-input-')); context.after(() => rm(root, { recursive: true, force: true }));
	const bytes = '{"identity":"actual-json"}\n'; await writeFile(join(root, 'data.json'), bytes);
	await writeFile(join(root, 'entry.js'), "import attributed from './data.json' with { type: 'json' }; import ordinary from './data.json'; console.log(attributed, ordinary);\n");
	const result = await build({ absWorkingDir: root, entryPoints: ['entry.js'], bundle: true, write: false, metafile: true, format: 'esm', logLevel: 'silent' });
	assert.ok(Object.values(result.metafile.inputs).some(input => input.with?.type === 'json'));
	const paths = physicalEsbuildInputPaths(result.metafile); assert.ok(paths.includes('data.json')); assert.ok(paths.includes('entry.js'));
	for (const path of paths.filter(path => path.endsWith('.json'))) assert.equal(await readFile(join(root, path), 'utf8'), bytes);
	assert.ok(paths.every(path => !path.includes(' with {')));
});

test('unattested attribute-looking text stays a physical filename and cannot bless an omitted JSON file', () => {
	const key = "data.json with { type: 'json' }";
	assert.deepEqual(physicalEsbuildInputPaths({ inputs: { [key]: { bytes: 1, imports: [] } } }), [key]);
});

test('attributed inputs normalize only the actual supported JSON metadata and JSON suffix', () => {
	const input = { bytes: 1, imports: [], with: { type: 'json' } };
	assert.deepEqual(physicalEsbuildInputPaths({ inputs: { "data.json with { type: 'json' }": input } }), ['data.json']);
	assert.deepEqual(physicalEsbuildInputPaths({ inputs: { 'data.json': input } }), ['data.json']);
	assert.throws(() => physicalEsbuildInputPaths({ inputs: { "code.js with { type: 'json' }": input } }), /JSON/iu);
	assert.throws(() => physicalEsbuildInputPaths({ inputs: { 'data.json': { ...input, with: { type: 'json', future: 'value' } } } }), /attribute/iu);
});
