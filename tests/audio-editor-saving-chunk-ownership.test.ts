/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath, EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST } from '../scripts/lib/build-chunk-groups.mjs';

test('the browser project picker stays in the lazy file-menu archive boundary', () => {
	const path = 'src/common/editor/browser-project-files.ts';
	assert.equal(EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST.test(path), true);
	assert.equal(chunkGroupForModulePath(path), null);
});
