/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { constants } from 'node:sqlite';
import test from 'node:test';
import { admitLightscaperNativeStackQueryPageCurrentV1 as admit,
	readAdmittedLightscaperNativeStackQueryPageCurrentV1 as readAdmitted,
	readLightscaperNativeStackQueryPageCurrentV1 as read } from '../desktop/lightscaper-native-stack-query-current-v1.ts';
import { nativeStackQueryFixtureCurrentV1 as fixture, seedNativeStackQueryCurrentV1 as seed,
	stackQueryCurrentV1 as query, CATALOG, key } from './helpers/lightscaper-native-stack-query-fixture-current.ts';

test('Lightscaper native collapsed Query2 captures inert closed requests before queued waits', async () => {
	await fixture(database => {
		seed(database, 2); const borrowed = { schemaVersion: 2, kind: 'photo-catalog-query', text: 'missing' };
		const admitted = admit(CATALOG, { query: borrowed }); borrowed.text = 'Ordinary';
		assert.equal(admitted.query.text, 'missing'); assert.equal(Object.isFrozen(admitted), true);
		assert.equal(readAdmitted(database, admitted).items.length, 0);
		let calls = 0;
		assert.throws(() => admit(CATALOG, { get query() { calls++; return query(); } }));
		assert.throws(() => admit(CATALOG, { query: query(), unexpected: true }));
		assert.throws(() => admit(CATALOG, { signal: { throwIfAborted() { calls++; } } }));
		assert.equal(calls, 0); assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native collapsed Query2 rejects forged packets and active caller transactions without nesting', async () => {
	await fixture(database => {
		seed(database, 2); const admitted = admit(CATALOG);
		assert.throws(() => readAdmitted(database, { ...admitted }), /admitted|owning/iu);
		database.exec('BEGIN');
		try { assert.throws(() => readAdmitted(database, admitted), /transaction|serialized|snapshot/iu); assert.equal(database.isTransaction, true); }
		finally { database.exec('ROLLBACK'); }
		assert.equal(readAdmitted(database, admitted).items.length, 2); assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native collapsed Query2 uses intrinsic cancellation and preserves opaque reasons before and during SQL', async () => {
	await fixture(database => {
		seed(database, 2); let traps = 0, borrowedCalls = 0, sql = 0;
		const reason = new Proxy({}, { get() { traps++; throw Error('Opaque property'); }, getPrototypeOf() { traps++; throw Error('Opaque prototype'); } });
		const early = new AbortController(); early.abort(reason);
		Object.defineProperty(early.signal, 'throwIfAborted', { value() { borrowedCalls++; } });
		database.setAuthorizer(() => { sql++; return constants.SQLITE_OK; });
		let failure: unknown;
		try { read(database, CATALOG, { signal: early.signal }); } catch (error) { failure = error; }
		assert.equal(failure, reason); assert.equal(sql, 0); assert.equal(borrowedCalls, 0); assert.equal(traps, 0);
		const during = new AbortController();
		database.setAuthorizer((action, table) => { if (action === constants.SQLITE_READ && table === 'native_photo_query_rows_v2') during.abort(reason); return constants.SQLITE_OK; });
		failure = undefined; try { read(database, CATALOG, { signal: during.signal }); } catch (error) { failure = error; }
		assert.equal(failure, reason); assert.equal(database.isTransaction, false); assert.equal(traps, 0);
		database.setAuthorizer(null); const late = new AbortController();
		const completed = read(database, CATALOG, { signal: late.signal }); late.abort(reason);
		assert.equal(completed.items.length, 2); assert.equal(completed.continuation, null); assert.equal(traps, 0);
	});
});

test('Lightscaper native collapsed Query2 preserves primary cancellation when actual SQLite rollback is refused', async () => {
	await fixture(database => {
		seed(database, 2); const stop = new AbortController(), reason = Object.freeze({ cause: 'owned abort' });
		database.setAuthorizer((action, first) => {
			if (action === constants.SQLITE_READ && first === 'native_photo_query_rows_v2') stop.abort(reason);
			if (action === constants.SQLITE_TRANSACTION && first === 'ROLLBACK') return constants.SQLITE_DENY;
			return constants.SQLITE_OK;
		});
		try {
			let failure: unknown; try { read(database, CATALOG, { signal: stop.signal }); } catch (error) { failure = error; }
			assert.ok(failure instanceof AggregateError); assert.equal(failure.errors.length, 2);
			assert.equal(failure.errors[0], reason); assert.ok(failure.errors[1] instanceof Error); assert.equal(database.isTransaction, true);
		} finally { database.setAuthorizer(null); if (database.isTransaction) database.exec('ROLLBACK'); }
		assert.equal(read(database, CATALOG).items.length, 2);
	});
});

test('Lightscaper native collapsed Query2 rolls back a corrupt selected native row and releases its SQL reader', async () => {
	await fixture(database => {
		seed(database, 2); const before = database.prepare('SELECT row_json FROM native_photo_query_rows_v2 WHERE photo_key=?').get(key(0));
		assert.equal(typeof before?.row_json, 'string');
		database.prepare('UPDATE native_photo_query_rows_v2 SET row_json=? WHERE photo_key=?').run('{broken', key(0));
		assert.throws(() => read(database, CATALOG)); assert.equal(database.isTransaction, false);
		database.prepare('UPDATE native_photo_query_rows_v2 SET row_json=? WHERE photo_key=?').run(before!.row_json!, key(0));
		const page = read(database, CATALOG); assert.equal(page.items.length, 2); assert.equal(page.continuation, null);
		// A new immediate writer succeeds after both failure and success. There is
		// no suspended native iterator left behind by a one-row seek.
		database.exec('BEGIN IMMEDIATE'); database.exec('ROLLBACK');
	});
});

test('Lightscaper native collapsed Query2 authenticates caller progress before opening any SQL snapshot', async () => {
	await fixture(database => {
		seed(database, 65); const first = read(database, CATALOG); assert.ok(first.continuation);
		const signed = first.continuation; let sql = 0;
		database.setAuthorizer(() => { sql++; return constants.SQLITE_OK; });
		const changed = signed.progressSha256[0] === '0' ? '1' : '0';
		assert.throws(() => read(database, CATALOG, { continuation: { ...signed, progressSha256: changed + signed.progressSha256.slice(1) } }));
		assert.equal(sql, 0); assert.equal(database.isTransaction, false);
		database.setAuthorizer(null); const next = read(database, CATALOG, { continuation: JSON.parse(JSON.stringify(signed)) as unknown });
		assert.equal(next.items.length, 1); assert.equal(next.continuation, null);
	});
});
