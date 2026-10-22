/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath, EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST } from '../scripts/lib/build-chunk-groups.mjs';

test('DAWproject curve and clock adapters stay in their lazy archive closure', () => {
	for (const name of ['export-automation', 'import-points', 'import-volume-curve']) {
		const path = `src/common/editor/dawproject-${name}.ts`;
		assert.ok(EDITOR_OPTIONAL_ARCHIVE_CHUNK_TEST.test(path), path);
		assert.equal(chunkGroupForModulePath(path), null, path);
	}
});
