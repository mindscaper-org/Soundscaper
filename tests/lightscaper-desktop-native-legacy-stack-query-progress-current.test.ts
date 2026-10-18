/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { constants, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { admitLightscaperNativeLegacyStackQueryPageCurrentV1 as admit, readAdmittedLightscaperNativeLegacyStackQueryPageCurrentV1 as readAdmitted,
	readLightscaperNativeLegacyStackQueryPageCurrentV1 as read } from '../desktop/lightscaper-native-legacy-stack-query-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { canonicalPhotoDocumentJsonV1 as json } from '../src/lightscaper/catalog/photo-document-json-v1.ts';
import { projectPhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { normalizePhotoStackV1, serializePhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { CATALOG, key, photoId, legacyQueryFixtureCurrentV1 as fixture, seedNativeLegacyQueryCurrentV1 as seed, putLegacyQueryRowCurrentV1 as put } from './helpers/lightscaper-native-legacy-query-fixture-current.ts';
import { observeNativeLegacyStackQueryReadsCurrentV1 as observe } from './helpers/lightscaper-native-legacy-stack-query-fixture-current.ts';
import { writeNativeStackQueryRowCurrentV1 as putV2 } from './helpers/lightscaper-native-stack-query-fixture-current.ts';

const large = { groups: [{ indices: Array.from({ length: 130 }, (_, index) => index), cover: 0 }] };
for (const table of ['native_photo_query_rows_v1', 'native_photo_stack_memberships']) {
	test(`Lightscaper native legacy collapsed resumed missing ${table} refuses before a representative escapes`, async () => {
		await fixture(database => {
			seed(database, 130, large); const ledger = observe(database);
			try {
				const first = read(database, CATALOG); assert.deepEqual(first.items, []); assert.ok(first.continuation?.pending); assert.equal(ledger.delivered.includes(photoId(100)), false);
				database.prepare(`DELETE FROM ${table} WHERE photo_key=?`).run(key(100));
				assert.throws(() => read(database, CATALOG, { continuation: first.continuation })); assert.equal(database.isTransaction, false);
			} finally { ledger.restore(); }
		});
	});
}
for (const fault of ['forward', 'position', 'source'] as const) {
	test(`Lightscaper native legacy collapsed point proof rejects actual ${fault} corruption despite ready Query2`, async () => {
		await fixture(database => {
			seed(database, 2, { groups: [{ indices: [0, 1], cover: 0 }] });
			if (fault === 'forward') database.prepare('DELETE FROM native_photo_stack_forward_members WHERE photo_key=?').run(key(1));
			if (fault === 'position') database.prepare('UPDATE native_photo_stack_memberships SET member_position=999 WHERE photo_key=?').run(key(1));
			if (fault === 'source') { database.exec('PRAGMA foreign_keys=OFF'); database.prepare('DELETE FROM native_photos WHERE photo_key=?').run(key(1)); database.exec('PRAGMA foreign_keys=ON'); }
			assert.throws(() => read(database, CATALOG)); assert.equal(database.isTransaction, false);
		});
	});
}

test('Lightscaper native legacy collapsed stale root index and grouping epochs outrank missing or unready legacy build', async () => {
	for (const epoch of ['root', 'index', 'state'] as const) for (const build of ['missing', 'unready'] as const) await fixture(database => {
		const f = seed(database, 130, large), first = read(database, CATALOG); assert.ok(first.continuation?.pending);
		if (epoch === 'root') database.prepare('UPDATE native_photo_catalogs SET document=?,root_revision=4').run(json({ ...f.root, revision: 4 }));
		if (epoch === 'index') database.exec('UPDATE native_photo_catalogs SET index_revision=12');
		if (epoch === 'state') database.exec('UPDATE native_photo_stack_states SET revision=6');
		database.exec(build === 'missing' ? 'DELETE FROM native_photo_query_builds_v1' : 'UPDATE native_photo_query_builds_v1 SET ready=0');
		assert.throws(() => read(database, CATALOG, { continuation: first.continuation }), { code: 'CATALOG_REVISION_CONFLICT' }); assert.equal(database.isTransaction, false);
	});
	for (const build of ['missing', 'unready'] as const) await fixture(database => {
		seed(database, 130, large); const first = read(database, CATALOG);
		database.exec(build === 'missing' ? 'DELETE FROM native_photo_query_builds_v1' : 'UPDATE native_photo_query_builds_v1 SET ready=0');
		assert.throws(() => read(database, CATALOG, { continuation: first.continuation }), { code: 'PHOTO_QUERY_INDEX_NOT_READY' });
	});
});

test('Lightscaper native legacy collapsed validates selected Row1 scalar projections and never materializes a later corrupt page early', async () => {
	for (const fault of ['rating_sort', 'photo_revision', 'file_name_key', 'row_json'] as const) await fixture(database => {
		seed(database, 2, { groups: [{ indices: [0, 1], cover: 0 }] });
		const changed = fault === 'row_json' ? '{broken' : fault === 'file_name_key' ? Uint8Array.of(0, 65) : 5;
		database.prepare(`UPDATE native_photo_query_rows_v1 SET ${fault}=? WHERE photo_key=?`).run(changed, key(1));
		assert.throws(() => read(database, CATALOG)); assert.equal(database.isTransaction, false);
	});
	await fixture(database => {
		seed(database); database.prepare('UPDATE native_photo_query_rows_v1 SET row_json=? WHERE photo_key=?').run('{broken', key(129));
		const first = read(database, CATALOG), second = read(database, CATALOG, { continuation: first.continuation }); assert.equal(first.scanned, 64); assert.equal(second.scanned, 64);
		assert.throws(() => read(database, CATALOG, { continuation: second.continuation }));
	});
});

test('Lightscaper native legacy collapsed admission detaches requests rejects forged packets and authenticates progress before BEGIN', async () => {
	await fixture(database => {
		seed(database, 130, large); const borrowed = { text: '' }, packet = admit(CATALOG, { query: borrowed }); borrowed.text = 'missing'; assert.ok(readAdmitted(database, packet).continuation?.pending);
		assert.throws(() => readAdmitted(database, { ...packet })); let getters = 0;
		assert.throws(() => admit(CATALOG, { get query() { getters++; return {}; } })); assert.equal(getters, 0);
		const first = read(database, CATALOG), continuation = first.continuation; assert.ok(continuation?.pending); let begins = 0;
		database.setAuthorizer((action, command) => { if (action === constants.SQLITE_TRANSACTION && command === 'BEGIN') begins++; return constants.SQLITE_OK; });
		assert.throws(() => read(database, CATALOG, { continuation: { ...continuation, pending: { ...continuation.pending, nextMember: 130 } } })); assert.equal(begins, 0);
		const other = new DatabaseSync(':memory:'); try { assert.throws(() => read(other, CATALOG, { continuation: first.continuation }), /signature|authentication|progress/iu); } finally { other.close(); }
		database.setAuthorizer(null); database.exec('BEGIN'); assert.throws(() => read(database, CATALOG), /transaction|snapshot/iu); assert.equal(database.isTransaction, true); database.exec('ROLLBACK');
	});
});

test('Lightscaper native legacy collapsed root stack source and both projection facts share one actual WAL snapshot', async () => {
	await fixture((database, path) => {
		const f = seed(database, 130, { groups: [{ indices: [0, 1], cover: 0 }] }), writer = new DatabaseSync(path); let changed = false;
		try {
			database.setAuthorizer((action, table) => {
				if (!changed && action === constants.SQLITE_READ && table === 'native_photo_stacks') {
					changed = true; const updated = normalizePhotoDocumentCurrentV1({ ...f.photos[0]!, revision: 1 }), group = normalizePhotoStackV1({ ...f.stacks[0]!, revision: 1, coverPhotoId: photoId(1) });
					writer.exec('BEGIN IMMEDIATE'); writer.prepare('UPDATE native_photo_catalogs SET document=?,root_revision=4,index_revision=12').run(json({ ...f.root, revision: 4 })); writer.exec('UPDATE native_photo_stack_states SET revision=6');
					writer.prepare('UPDATE native_photos SET document=?,summary=?,revision=1 WHERE photo_key=?').run(json(updated), json(photoSummary(updated)), key(0)); put(writer, projectPhotoQueryRowV1(updated)); putV2(writer, projectPhotoQueryRowV2(updated));
					writer.prepare('UPDATE native_photo_stacks SET document=?,revision=1,cover_photo_id=? WHERE stack_key=?').run(serializePhotoStackV1(group), group.coverPhotoId, photoStorageKey(CATALOG, group.id)); writer.exec('COMMIT');
				}
				return constants.SQLITE_OK;
			});
			const first = read(database, CATALOG); assert.equal(changed, true); assert.equal(first.items[0]?.photoId, photoId(0)); assert.equal(first.items[0]?.photoRevision, 0);
			assert.ok(first.continuation); assert.equal(first.continuation.catalogRevision, 3); assert.equal(first.continuation.indexRevision, 11); assert.equal(first.continuation.stateRevision, 5);
			database.setAuthorizer(null); assert.throws(() => read(database, CATALOG, { continuation: first.continuation }), { code: 'CATALOG_REVISION_CONFLICT' }); assert.equal(read(database, CATALOG).items[0]?.photoId, photoId(1));
		} finally { database.setAuthorizer(null); writer.close(); }
	});
});

test('Lightscaper native legacy collapsed intrinsic opaque abort joins rollback and preserves cleanup failure causes', async () => {
	await fixture(database => {
		seed(database, 2); const stop = new AbortController(); let traps = 0;
		const reason = new Proxy({}, { get() { traps++; throw Error('Opaque reason read.'); }, getPrototypeOf() { traps++; throw Error('Opaque reason prototype.'); } });
		database.setAuthorizer((action, table) => { if (action === constants.SQLITE_READ && table === 'native_photo_query_rows_v1') stop.abort(reason); return constants.SQLITE_OK; });
		let failure: unknown; try { read(database, CATALOG, { signal: stop.signal }); } catch (error) { failure = error; }
		assert.equal(failure, reason); assert.equal(traps, 0); assert.equal(database.isTransaction, false); database.setAuthorizer(null);
		const cleanupStop = new AbortController();
		database.setAuthorizer((action, command) => {
			if (action === constants.SQLITE_READ && command === 'native_photo_query_rows_v1') cleanupStop.abort(reason);
			if (action === constants.SQLITE_TRANSACTION && command === 'ROLLBACK') return constants.SQLITE_DENY;
			return constants.SQLITE_OK;
		});
		let combined: unknown; try { read(database, CATALOG, { signal: cleanupStop.signal }); } catch (error) { combined = error; }
		assert.ok(combined instanceof AggregateError); assert.equal(combined.errors[0], reason); assert.equal(combined.errors.length, 2); assert.equal(traps, 0);
		database.setAuthorizer(null); if (database.isTransaction) database.exec('ROLLBACK');
	});
});
