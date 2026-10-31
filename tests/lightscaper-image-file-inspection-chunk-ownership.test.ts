/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import { EAGER_CHUNK_GROUPS } from './helpers/eager-chunk-group-crossings.ts';

const OWNER = 'editor-image-file-admission';
const LEAVES = ['editor/browser-image-precision-admission.ts', 'imaging/image-animation-topology.ts'];

void test('encoded-byte precision and topology inspection use the exact existing optional file-admission owner', () => {
	for (const leaf of LEAVES) for (const separator of ['/', '\\']) {
		const path = `src/common/${leaf}`.replaceAll('/', separator);
		assert.equal(chunkGroupForModulePath(path), OWNER, path);
		for (const foreign of [path + '.foreign', path.replace('.ts', '-extra.ts'),
			`src/common/internal/${leaf}`.replaceAll('/', separator)]) assert.notEqual(chunkGroupForModulePath(foreign), OWNER, foreign);
	}
	const owner = chunkGroups.find(group => group.name === OWNER); assert.ok(owner);
	assert.equal(owner.priority, 99); assert.equal(owner.minSize, 0); assert.equal(owner.maxSize, 400_000);
	assert.equal(owner.includeDependenciesRecursively, false); assert.equal(EAGER_CHUNK_GROUPS.has(OWNER), false);
});

for (const leaf of LEAVES) void test(`${leaf} has no executable timeline, storage, rendering or decoder passengers`, async () => {
	const path = `src/common/${leaf}`;
	const output = await build({ entryPoints: [fileURLToPath(new URL('../' + path, import.meta.url))],
		bundle: true, write: false, platform: 'browser', format: 'esm', metafile: true, logLevel: 'silent' });
	assert.ok(output.metafile);
	assert.deepEqual(Object.keys(output.metafile.inputs), [path], 'the ReviewedImageFormat type import carries no runtime');
});
