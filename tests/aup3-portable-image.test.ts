/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { initializeAup3Database } from '../src/common/editor/aup3-database.ts';
import { finalizeAup3PortableImage } from '../src/common/editor/aup3-portable-image.ts';
import { prepareAudacitySerializedDatabase } from '../src/common/editor/aup4-database.js';
import { SQL } from './helpers/aup4-database-harness.js';

test('AUP3 image finalization changes only the journal flags of its owned export', () => {
	const database = new SQL.Database();
	try {
		initializeAup3Database(database);
		const bytes = database.export() as Uint8Array;
		const original = bytes.slice();
		assert.deepEqual([...original.subarray(18, 20)], [1, 1]);
		assert.equal(finalizeAup3PortableImage(bytes), bytes);
		assert.deepEqual([...bytes.subarray(18, 20)], [2, 2]);
		assert.deepEqual(bytes.subarray(0, 18), original.subarray(0, 18));
		assert.deepEqual(bytes.subarray(20), original.subarray(20));
		assert.equal(finalizeAup3PortableImage(bytes), bytes);
		// Soundscaper normalizes only its private import copy for browser SQLite.
		assert.deepEqual(prepareAudacitySerializedDatabase(bytes), original);
		assert.deepEqual([...bytes.subarray(18, 20)], [2, 2]);
		assert.equal(database.exec('PRAGMA journal_mode')[0]?.values[0]?.[0], 'delete');
	} finally {
		database.close();
	}
});

test('AUP3 image finalization rejects truncated or non-SQLite images without changing them', () => {
	for (const bytes of [new Uint8Array(99), new Uint8Array(100)]) {
		const original = bytes.slice();
		assert.throws(() => finalizeAup3PortableImage(bytes), { code: 'INVALID_DATABASE' });
		assert.deepEqual(bytes, original);
	}
});
