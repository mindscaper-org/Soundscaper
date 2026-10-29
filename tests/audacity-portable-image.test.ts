/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { initializeAup3Database } from '../src/common/editor/aup3-database.ts';
import { finalizeAudacityPortableImage } from '../src/common/editor/audacity-portable-image.ts';
import { initializeAup4Database, prepareAudacitySerializedDatabase } from '../src/common/editor/aup4-database.js';
import { SQL } from './helpers/aup4-database-harness.js';

for (const [generation, initialize] of [
	['AUP3', initializeAup3Database], ['AUP4', initializeAup4Database],
] as const) {
	test(`${generation} image finalization changes only the journal flags of its owned export`, () => {
		const database = new SQL.Database();
		try {
			initialize(database);
			const bytes = database.export() as Uint8Array;
			const original = bytes.slice();
			assert.deepEqual([...original.subarray(18, 20)], [1, 1]);
			assert.equal(finalizeAudacityPortableImage(bytes), bytes);
			assert.deepEqual([...bytes.subarray(18, 20)], [2, 2]);
			assert.deepEqual(bytes.subarray(0, 18), original.subarray(0, 18));
			assert.deepEqual(bytes.subarray(20), original.subarray(20));
			assert.equal(finalizeAudacityPortableImage(bytes), bytes);
			// Soundscaper normalizes only its private import copy for browser SQLite.
			assert.deepEqual(prepareAudacitySerializedDatabase(bytes), original);
			assert.deepEqual([...bytes.subarray(18, 20)], [2, 2]);
			assert.equal(database.exec('PRAGMA journal_mode')[0]?.values[0]?.[0], 'delete');
		} finally {
			database.close();
		}
	});
}

test('Audacity image finalization rejects truncated or non-SQLite images without changing them', () => {
	for (const bytes of [new Uint8Array(99), new Uint8Array(100)]) {
		const original = bytes.slice();
		assert.throws(() => finalizeAudacityPortableImage(bytes), { code: 'INVALID_DATABASE' });
		assert.deepEqual(bytes, original);
	}
});
