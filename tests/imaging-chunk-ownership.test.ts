/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('extracted image kernels retain their semantic chunk owner across source paths', () => {
	const images = readdirSync(new URL('../src/common/imaging/', import.meta.url)).filter(file => file.endsWith('.ts'));
	for (const file of images) {
		const path = `src/common/imaging/${file}`;
		assert.equal(chunkGroupForModulePath(path), 'editor-domain', path);
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), 'editor-domain', path);
	}
	assert.equal(chunkGroupForModulePath('src/common/foundation/closed-domain-value.ts'), 'editor-domain');
});
