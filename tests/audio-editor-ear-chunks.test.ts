/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('EAR rendering and reporting stay behind the existing lazy export owner', () => {
	for (const path of [
		'src/common/editor/spatial-delivery-conversions.ts',
		'src/common/editor/controller/export/internal/ear-render-worker-client.ts',
		'src/common/editor/controller/export/internal/spatial-render-project.ts',
	]) assert.equal(chunkGroupForModulePath(path), 'editor-optional-export', path);
	assert.equal(chunkGroupForModulePath('src/common/editor/ear/layouts.ts'), 'editor-domain');
});
