/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { constants, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { readLightscaperNativeStackQueryPageCurrentV1 as read } from '../desktop/lightscaper-native-stack-query-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { canonicalPhotoDocumentJsonV1 as json } from '../src/lightscaper/catalog/photo-document-json-v1.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { normalizePhotoStackV1, serializePhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { CATALOG, key, photoId, nativeStackQueryFixtureCurrentV1 as fixture, seedNativeStackQueryCurrentV1 as seed,
	stackQueryCurrentV1 as query, observeNativeStackQueryReadsCurrentV1 as observe,
	writeNativeStackQueryRowCurrentV1 as writeRow } from './helpers/lightscaper-native-stack-query-fixture-current.ts';

const GROUP = { indices: Array.from({ length: 130 }, (_, index) => index), cover: 0 };

for (const table of ['native_photo_query_rows_v2', 'native_photo_stack_memberships']) {
	test(`Lightscaper native collapsed Query2 resumed closure refuses unvisited missing ${table} before cover publication`, async () => {
		await fixture(database => {
			seed(database, 130, { groups: [GROUP] }); const observed = observe(database);
			try {
				const first = read(database, CATALOG); assert.deepEqual(first.items, []); assert.ok(first.continuation?.pending);
				assert.equal(observed.delivered.includes(photoId(100)), false);
				database.prepare(`DELETE FROM ${table} WHERE photo_key=?`).run(key(100));
				let continuation = first.continuation, failed = false;
				for (let step = 0; step < 5 && !failed; step++) {
					try { const page = read(database, CATALOG, { continuation }); assert.deepEqual(page.items, []); assert.ok(page.continuation); continuation = page.continuation; }
					catch (error) { assert.match(String(error), /missing|membership|reverse|forward/iu); failed = true; }
				}
				assert.equal(failed, true); assert.equal(database.isTransaction, false);
			} finally { observed.restore(); }
		});
	});
}

for (const fault of ['missing-reverse', 'missing-forward', 'wrong-position', 'missing-source', 'missing-parent'] as const) {
	test(`Lightscaper native collapsed Query2 refuses actual ${fault} membership corruption without repairing authority`, async () => {
		await fixture(database => {
			seed(database, 2, { groups: [{ indices: [0, 1], cover: 0 }] });
			if (fault === 'missing-reverse') database.prepare('DELETE FROM native_photo_stack_memberships WHERE photo_key=?').run(key(1));
			if (fault === 'missing-forward') database.prepare('DELETE FROM native_photo_stack_forward_members WHERE photo_key=?').run(key(1));
			if (fault === 'wrong-position') database.prepare('UPDATE native_photo_stack_memberships SET member_position=999 WHERE photo_key=?').run(key(1));
			if (fault === 'missing-source') { database.exec('PRAGMA foreign_keys=OFF'); database.prepare('DELETE FROM native_photos WHERE photo_key=?').run(key(1)); database.exec('PRAGMA foreign_keys=ON'); }
			if (fault === 'missing-parent') database.exec('DELETE FROM native_photo_stacks');
			const tables = ['native_photo_catalogs', 'native_photo_query_builds_v2', 'native_photo_stack_states', 'native_photo_stacks', 'native_photo_stack_forward_members', 'native_photo_stack_memberships'];
			const before = tables.map(table => database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
			assert.throws(() => read(database, CATALOG)); assert.equal(database.isTransaction, false);
			assert.deepEqual(tables.map(table => database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()), before);
		});
	});
}

test('Lightscaper native collapsed Query2 refuses missing unready inconsistent build and positive or zero grouping count contradictions', async () => {
	for (const fault of ['missing-build', 'unready', 'build-count', 'too-few-stacks', 'too-many-stacks', 'zero-state'] as const) await fixture(database => {
		seed(database, 4, { groups: [{ indices: [0, 1], cover: 0 }, { indices: [2, 3], cover: 2 }] });
		if (fault === 'missing-build') database.exec('DELETE FROM native_photo_query_builds_v2');
		if (fault === 'unready') database.exec('UPDATE native_photo_query_builds_v2 SET ready=0');
		if (fault === 'build-count') database.exec('UPDATE native_photo_query_builds_v2 SET indexed_count=3');
		if (fault === 'too-few-stacks') database.prepare('DELETE FROM native_photo_stacks WHERE stack_id=?').run('stack-000001');
		if (fault === 'too-many-stacks') database.exec('UPDATE native_photo_stack_states SET stack_count=1');
		if (fault === 'zero-state') database.exec('UPDATE native_photo_stack_states SET stack_count=0');
		if (fault === 'missing-build' || fault === 'unready') assert.throws(() => read(database, CATALOG), { code: 'PHOTO_QUERY_INDEX_NOT_READY' });
		else assert.throws(() => read(database, CATALOG));
		assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native collapsed Query2 refuses selected native Row2 projection scalars while later corrupt rows stay unmaterialized', async () => {
	for (const fault of ['rating', 'revision', 'filename', 'json'] as const) await fixture(database => {
		seed(database, 2, { groups: [{ indices: [0, 1], cover: 0 }] });
		if (fault === 'rating') database.prepare('UPDATE native_photo_query_rows_v2 SET rating_sort=5 WHERE photo_key=?').run(key(1));
		if (fault === 'revision') database.prepare('UPDATE native_photo_query_rows_v2 SET photo_revision=1 WHERE photo_key=?').run(key(1));
		if (fault === 'filename') database.prepare('UPDATE native_photo_query_rows_v2 SET file_name_key=? WHERE photo_key=?').run(Uint8Array.of(0, 65), key(1));
		if (fault === 'json') database.prepare('UPDATE native_photo_query_rows_v2 SET row_json=? WHERE photo_key=?').run('{broken', key(1));
		assert.throws(() => read(database, CATALOG)); assert.equal(database.isTransaction, false);
	});
	await fixture(database => {
		seed(database); database.prepare('UPDATE native_photo_query_rows_v2 SET row_json=? WHERE photo_key=?').run('{broken', key(129));
		const first = read(database, CATALOG), second = read(database, CATALOG, { continuation: first.continuation });
		assert.equal(first.scanned, 64); assert.equal(second.scanned, 64); assert.throws(() => read(database, CATALOG, { continuation: second.continuation }));
	});
});

test('Lightscaper native collapsed Query2 tampered behavioral progress cannot skip member or stack audit work', async () => {
	await fixture(database => {
		seed(database, 130, { groups: [GROUP] }); const first = read(database, CATALOG); assert.ok(first.continuation?.pending);
		const genuine = first.continuation;
		for (const continuation of [{ ...genuine, pending: { ...genuine.pending, nextMember: 130 } },
			{ ...genuine, pending: { ...genuine.pending, stackRevision: 1 } }, { ...genuine, progressSha256: '0'.repeat(64) }]) {
			assert.throws(() => read(database, CATALOG, { continuation }), /signature|authentication|progress/iu);
		}
		const roundTrip: unknown = JSON.parse(JSON.stringify(genuine));
		const next = read(database, CATALOG, { continuation: roundTrip }); assert.equal(next.items.length, 0); assert.ok(next.continuation?.pending);
		assert.throws(() => read(database, CATALOG, { query: query({ text: 'changed' }), continuation: genuine }));
		assert.throws(() => read(database, 'other', { continuation: genuine }));
	});
	await fixture(database => {
		const groups = Array.from({ length: 65 }, (_, index) => ({ indices: [index * 2, index * 2 + 1], cover: index * 2 }));
		seed(database, 130, { groups }); const first = read(database, CATALOG); assert.ok(first.continuation?.stackAudit);
		const forged = { ...first.continuation, stackAudit: { ...first.continuation.stackAudit, count: 65 } };
		assert.throws(() => read(database, CATALOG, { continuation: forged }), /signature|authentication|progress/iu);
	});
});

test('Lightscaper native collapsed Query2 genuine pending pages fence each fresh root index and stack epoch', async () => {
	for (const epoch of ['root', 'index', 'state'] as const) await fixture(database => {
		const f = seed(database, 130, { groups: [GROUP] }), first = read(database, CATALOG); assert.ok(first.continuation?.pending);
		if (epoch === 'root') database.prepare('UPDATE native_photo_catalogs SET document=?,root_revision=4').run(json({ ...f.root, revision: 4 }));
		if (epoch === 'index') database.exec('UPDATE native_photo_catalogs SET index_revision=12');
		if (epoch === 'state') database.exec('UPDATE native_photo_stack_states SET revision=6');
		assert.throws(() => read(database, CATALOG, { continuation: first.continuation }), { code: 'CATALOG_REVISION_CONFLICT' });
		assert.equal(database.isTransaction, false);
	});
});

test('Lightscaper native collapsed Query2 binds signed continuation to its actual SQLite connection even on the same file', async () => {
	await fixture((database, path) => {
		seed(database, 130, { groups: [GROUP] }); const first = read(database, CATALOG); assert.ok(first.continuation);
		const second = new DatabaseSync(path);
		try {
			assert.throws(() => read(second, CATALOG, { continuation: first.continuation }), /signature|authentication|progress/iu);
			assert.equal(second.isTransaction, false); assert.ok(read(database, CATALOG, { continuation: first.continuation }).continuation);
		} finally { second.close(); }
	});
});

test('Lightscaper native collapsed Query2 root index state candidate and membership facts retain one real WAL snapshot', async () => {
	await fixture((database, path) => {
		const f = seed(database, 130, { groups: [{ indices: [0, 1], cover: 0 }] }), writer = new DatabaseSync(path); let changed = false;
		try {
			database.setAuthorizer((action, table) => {
				if (!changed && action === constants.SQLITE_READ && table === 'native_photo_stacks') {
					changed = true; const before = f.photos[0]!, updated = normalizePhotoDocumentCurrentV1({ ...before, revision: 1, metadata: { ...before.metadata, title: 'Later snapshot' } });
					const group = normalizePhotoStackV1({ ...f.stacks[0]!, revision: 1, coverPhotoId: photoId(1) }); writer.exec('BEGIN IMMEDIATE');
					writer.prepare('UPDATE native_photo_catalogs SET document=?,root_revision=4,index_revision=12').run(json({ ...f.root, revision: 4, name: 'Later catalog' }));
					writer.exec('UPDATE native_photo_stack_states SET revision=6');
					writer.prepare('UPDATE native_photos SET document=?,summary=?,revision=1 WHERE photo_key=?').run(json(updated), json(photoSummary(updated)), key(0)); writeRow(writer, projectPhotoQueryRowV2(updated));
					writer.prepare('UPDATE native_photo_stacks SET document=?,revision=1,cover_photo_id=? WHERE stack_key=?').run(serializePhotoStackV1(group), group.coverPhotoId, photoStorageKey(CATALOG, group.id));
					writer.exec('COMMIT');
				}
				return constants.SQLITE_OK;
			});
			const first = read(database, CATALOG); assert.equal(changed, true); assert.equal(first.catalogRevision, 3); assert.equal(first.indexRevision, 11); assert.equal(first.stateRevision, 5);
			assert.equal(first.items[0]?.photoId, photoId(0)); assert.equal(first.items[0]?.photoRevision, 0); assert.ok(first.continuation);
			database.setAuthorizer(null);
			assert.throws(() => read(database, CATALOG, { continuation: first.continuation }), { code: 'CATALOG_REVISION_CONFLICT' });
			const fresh = read(database, CATALOG); assert.equal(fresh.catalogRevision, 4); assert.equal(fresh.indexRevision, 12); assert.equal(fresh.stateRevision, 6);
			assert.equal(fresh.catalogName, 'Later catalog'); assert.equal(fresh.items[0]?.photoId, photoId(1)); assert.equal(database.isTransaction, false);
		} finally { database.setAuthorizer(null); writer.close(); }
	});
});

test('Lightscaper native collapsed Query2 pending proof rejects actual index-only metadata commits between phases', async () => {
	await fixture((database, path) => {
		const f = seed(database, 130, { groups: [GROUP] }), first = read(database, CATALOG), writer = new DatabaseSync(path); assert.ok(first.continuation?.pending);
		try {
			const old = f.photos[100]!, next = normalizePhotoDocumentCurrentV1({ ...old, revision: 1, metadata: { ...old.metadata, title: 'Changed without root edit' } });
			writer.exec('BEGIN IMMEDIATE'); writer.exec('UPDATE native_photo_catalogs SET index_revision=12');
			writer.prepare('UPDATE native_photos SET document=?,summary=?,revision=1 WHERE photo_key=?').run(json(next), json(photoSummary(next)), key(100)); writeRow(writer, projectPhotoQueryRowV2(next)); writer.exec('COMMIT');
			assert.throws(() => read(database, CATALOG, { continuation: first.continuation }), { code: 'CATALOG_REVISION_CONFLICT' });
			assert.equal(read(database, CATALOG).catalogRevision, 3);
		} finally { writer.close(); }
	});
});
