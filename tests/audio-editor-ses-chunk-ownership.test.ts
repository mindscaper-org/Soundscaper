/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath, EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST } from '../scripts/lib/build-chunk-groups.mjs';

test('legacy binary session parsing and conversion stay behind the desktop import action', () => {
	for (const name of ['ses-import', 'ses-import-project']) {
		const path = `src/common/editor/${name}.ts`;
		assert.ok(EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST.test(path), path);
		assert.equal(chunkGroupForModulePath(path), null, path);
	}
});
