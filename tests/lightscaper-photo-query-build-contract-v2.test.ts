/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readPhotoQueryBuildStateV2 as pureBuild } from '../src/lightscaper/catalog/photo-query-build-contract-v2.ts';
import { readPhotoQueryBuildStateV2 as previousBuild } from '../src/lightscaper/catalog/photo-query-index-storage-v2.ts';

void test('Lightscaper restore pure Query2 build extraction preserves existing public function identity and grammar', () => {
	assert.equal(previousBuild, pureBuild);
	const value = { id: 'catalog', schemaVersion: 2, ready: false, afterKey: 'catalog|photo', indexedCount: 7 };
	assert.deepEqual(pureBuild(value, 'catalog'), value); assert.throws(() => pureBuild({ ...value, afterKey: 'foreign|photo' }, 'catalog'));
});
