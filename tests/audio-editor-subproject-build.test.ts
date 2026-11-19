/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('subproject scheduling, graph traversal and rendering remain in the optional delivery chunk', () => {
	for (const name of ['subproject-actions', 'internal/subprojects/subproject-graph', 'internal/subprojects/subproject-renderer']) {
		assert.equal(chunkGroupForModulePath(`src/common/editor/controller/document/${name}.ts`), 'editor-optional-export');
	}
});
