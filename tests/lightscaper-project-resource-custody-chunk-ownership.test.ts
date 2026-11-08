/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';

const OWNER = 'editor-media-storage-contracts';
const LEAVES = ['video-cube-lut-project-references-v1.ts', 'video-cube-lut-project-references-current-v1.ts',
	'internal/video-cube-lut-project-references-kernel-v1.ts'];

void test('project-resource custody retains the exact shared retention owner rather than timeline-domain ownership', () => {
	for (const leaf of LEAVES) for (const separator of ['/', '\\']) {
		const path = `src/common/editor/${leaf}`.replaceAll('/', separator);
		assert.equal(chunkGroupForModulePath(path), OWNER, leaf);
		for (const foreign of [path + '.foreign', path.replace('-v1.ts', '-v2.ts'),
			`src/common/editor/internal/nested/${leaf.split('/').at(-1)!}`.replaceAll('/', separator)]) {
			assert.notEqual(chunkGroupForModulePath(foreign), OWNER, foreign);
		}
	}
	const owner = chunkGroups.find(group => group.name === OWNER); assert.ok(owner);
	assert.equal(owner.priority, 99); assert.equal(owner.minSize, 0); assert.equal(owner.maxSize, 400_000);
	assert.equal(owner.includeDependenciesRecursively, false);
});

for (const leaf of LEAVES.slice(0, 2)) {
	void test(`${leaf} keeps complete scalar source/resource admission without acquiring product or body execution`, async () => {
		const output = await build({ entryPoints: [fileURLToPath(new URL(`../src/common/editor/${leaf}`, import.meta.url))],
			bundle: true, write: false, platform: 'browser', format: 'esm', metafile: true, logLevel: 'silent' });
		assert.ok(output.metafile);
		const inputs = Object.keys(output.metafile.inputs);
		for (const required of ['internal/video-cube-lut-project-references-kernel-v1.ts',
			'timeline-image-model-v2.ts', 'timeline-image-model-current-v1.ts',
			'imaging/image-develop-resource-reachability-current-v1.ts']) {
			assert.ok(inputs.includes(`src/common/editor/${required}`), `${leaf} omits ${required}`);
		}
		for (const path of inputs) {
			assert.ok(!path.startsWith('src/framescaper/') && !path.startsWith('src/lightscaper/'), path);
			assert.ok(!path.includes('/editor/storage/') && !path.includes('/editor/controller/'), path);
			assert.doesNotMatch(path, /\/(?:ffmpeg[^/]*|libraw-(?:runtime|wasm-instance)[^/]*|image-develop-frame-[^/]*|pixel-frame-webgl2-[^/]*)\.[cm]?[jt]sx?$/u);
			if (path.startsWith('src/common/editor/')) assert.notEqual(chunkGroupForModulePath(path), 'editor-domain', path);
		}
	});
}
