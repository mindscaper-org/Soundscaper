/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLightscaperNativeSmartCollectionArchiveCurrentV1 as create } from '../desktop/lightscaper-native-smart-collection-archive-current-v1.ts';
import { seedNativeSmartCollectionFixtureCurrentV1 as seed } from './helpers/lightscaper-native-smart-collection-fixture-current.ts';
import { nativeStackQueryFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-stack-query-fixture-current.ts';

for (const state of [null, 0, 9]) test(`Lightscaper native saved archive preserves physical ${String(state)} state and verifies empty inventory once`, async () => {
	await fixture(async db => {
		seed(db, 0, state); const owner = create(db, 'catalog');
		try {
			assert.equal(typeof owner.retire, 'function'); const capture = await owner.capture;
			assert.equal(capture.context.state?.revision ?? null, state); assert.equal(db.isTransaction, false);
			const items = []; for await (const definition of capture.definitions) items.push(definition); assert.deepEqual(items, []);
			await capture.verify(); await assert.rejects(capture.verify()); assert.throws(() => capture.definitions[Symbol.asyncIterator]());
		} finally { await owner.retire(); assert.equal(owner.retire(), owner.retire()); }
	});
});

test('Lightscaper native saved archive streams70 canonical definitions one at a time without held transactions or Photo aggregates', async () => {
	await fixture(async db => {
		const f = seed(db, 70); const owner = create(db, 'catalog');
		try {
			const capture = await owner.capture, ids: string[] = [];
			for await (const definition of capture.definitions) { ids.push(definition.id); assert.equal(db.isTransaction, false); }
			assert.deepEqual(ids, f.definitions.map(definition => definition.id)); await capture.verify();
		} finally { await owner.retire(); }
	});
});

test('Lightscaper native saved archive refuses overlapping operations and incomplete return verification', async () => {
	await fixture(async db => {
		seed(db, 2); const owner = create(db, 'catalog');
		try {
			const capture = await owner.capture, iterator = capture.definitions[Symbol.asyncIterator](), first = iterator.next();
			const nextRefused = assert.rejects(iterator.next(), /pending|active/iu), verifyRefused = assert.rejects(capture.verify(), /pending|active/iu);
			await Promise.all([nextRefused, verifyRefused]); assert.equal((await first).done, false);
			await iterator.return?.(); assert.equal(db.isTransaction, false); await assert.rejects(capture.verify(), /count|incomplete/iu);
		} finally { await owner.retire(); }
	});
});

test('Lightscaper native saved archive final audit detects same-revision definition mutation and physical state disappearance', async () => {
	await fixture(async db => {
		seed(db, 2); const owner = create(db, 'catalog');
		try {
			const capture = await owner.capture; for await (const definition of capture.definitions) assert.ok(definition.id);
			db.exec('DELETE FROM native_photo_smart_collection_states'); await assert.rejects(capture.verify()); assert.equal(db.isTransaction, false);
		} finally { await owner.retire(); }
	});
});

test('Lightscaper native saved archive demand read refuses changed complete query bytes before delivery', async () => {
	await fixture(async db => {
		const f = seed(db, 2); const owner = create(db, 'catalog');
		try {
			const capture = await owner.capture, value = { ...f.definitions[0]!, query: { ...f.definitions[0]!.query, text: 'changed' } };
			db.prepare('UPDATE native_photo_smart_collections SET document=? WHERE collection_key=?').run(JSON.stringify(value), f.key(0));
			const iterator = capture.definitions[Symbol.asyncIterator](); await iterator.next(); await iterator.next(); await assert.rejects(iterator.next(), /digest|snapshot|changed/iu);
		} finally { await owner.retire(); }
	});
});

test('Lightscaper native saved archive has a retirement handle before initialization and preserves exact opaque cancellation', async () => {
	await fixture(async db => {
		seed(db, 70); const stop = new AbortController(); let traps = 0;
		const reason = new Proxy({}, { get() { traps++; throw Error('Opaque cancellation'); }, getPrototypeOf() { traps++; throw Error('Opaque cancellation'); } });
		const owner = create(db, 'catalog', { signal: stop.signal }), rejected = owner.capture.then(() => assert.fail('Initialization must abort'), (error: unknown) => { assert.equal(error, reason); });
		stop.abort(reason); await rejected; await owner.retire(); assert.equal(traps, 0); assert.equal(db.isTransaction, false);
	});
});

test('Lightscaper native saved archive retire joins active next and fences further work without deleting the database', async () => {
	await fixture(async db => {
		seed(db, 2); const owner = create(db, 'catalog'), capture = await owner.capture, iterator = capture.definitions[Symbol.asyncIterator]();
		const pending = iterator.next(), retired = owner.retire(); await Promise.allSettled([pending]); await retired;
		assert.equal(owner.retire(), retired); assert.equal(db.isTransaction, false); assert.equal(db.isOpen, true); assert.equal((await iterator.next()).done, true); await assert.rejects(capture.verify());
	});
});

test('Lightscaper native saved archive initialization catches orphan summary and incomplete raw Query2 instead of default repair', async () => {
	await fixture(async db => {
		const f = seed(db, 1), raw = { ...f.definitions[0]!, query: { schemaVersion: 2, kind: 'photo-catalog-query' } };
		db.prepare('UPDATE native_photo_smart_collections SET document=? WHERE collection_key=?').run(JSON.stringify(raw), f.key(0));
		const owner = create(db, 'catalog'); await assert.rejects(owner.capture); await owner.retire(); assert.equal(db.isTransaction, false);
	});
});
