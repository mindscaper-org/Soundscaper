/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('extracted image kernels retain their semantic chunk owner across source paths', () => {
	const images = readdirSync(new URL('../src/common/imaging/', import.meta.url)).filter(file => file.endsWith('.ts'));
	const owners: Readonly<Record<string, string>> = {
		'cube-lut-reference-contract.ts': 'editor-media-storage-contracts',
		'image-animation-topology.ts': 'editor-image-file-admission',
	};
	for (const file of images) {
		const owner = owners[file] ?? 'editor-imaging';
		const path = `src/common/imaging/${file}`;
		assert.equal(chunkGroupForModulePath(path), owner, path);
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), owner, path);
	}
	assert.equal(chunkGroupForModulePath('src/common/foundation/closed-domain-value.ts'), 'editor-neutral-foundations');
});

test('extracted byte and scalar modules retain their existing nonrecursive chunk owners', () => {
	const owners = [
		['foundation/abort-error.ts', 'editor-neutral-foundations'],
		['foundation/abort-race.ts', 'editor-neutral-foundations'],
		['foundation/closed-domain-value.ts', 'editor-neutral-foundations'],
		['media/content-digest.ts', 'editor-media-custody-storage'],
		['media/indexeddb.ts', 'editor-media-custody-storage'],
		['media/bytes.ts', 'editor-scape-archive-bytes'],
		['scape/abort.ts', 'editor-scape-archive-bytes'],
		['scape/archive-zip-profile.ts', 'editor-scape-archive-bytes'],
		['scape/archive-limits.ts', 'editor-neutral-foundations'],
	] as const;
	for (const [module, owner] of owners) {
		const path = `src/common/${module}`;
		assert.equal(chunkGroupForModulePath(path), owner, path);
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), owner, path);
		assert.notEqual(chunkGroupForModulePath(path + '.foreign'), owner, path);
	}
});
