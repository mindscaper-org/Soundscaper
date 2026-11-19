/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { admitLightscaperNativeSmartCollectionQueryCurrentV1 as admit, readAdmittedLightscaperNativeSmartCollectionQueryCurrentV1 as readAdmitted,
	readLightscaperNativeSmartCollectionQueryPageCurrentV1 as ordinary, readLightscaperNativeSmartCollectionStackQueryPageCurrentV1 as collapsed } from '../desktop/lightscaper-native-smart-collection-query-current-v1.ts';
import { PhotoSmartCollectionRevisionConflictError } from '../src/lightscaper/catalog/photo-smart-collection-repository-types-v1.ts';
import { PhotoQueryIndexNotReadyError } from '../src/lightscaper/catalog/photo-query-errors.ts';
import { normalizePhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { photoQueryMatcherV2 } from '../src/lightscaper/catalog/photo-query-matcher-v2.ts';
import type { PhotoSavedQueryPageV1, PhotoSavedQueryContinuationV1 } from '../src/lightscaper/catalog/photo-smart-collection-query-types-v1.ts';
import { insertNativeSmartCollectionFixtureCurrentV1 as insert } from './helpers/lightscaper-native-smart-collection-fixture-current.ts';
import { CATALOG, photoId, nativeStackQueryFixtureCurrentV1 as fixture, seedNativeStackQueryCurrentV1 as seed,
	stackQueryCurrentV1 as query, expectedNativeStackQueryCurrentV1 as expected, compareNativeStackQueryRowsCurrentV1 as compare,
	forbidNativeStackQueryAggregatesCurrentV1 as forbid, observeNativeStackQueryReadsCurrentV1 as observe } from './helpers/lightscaper-native-stack-query-fixture-current.ts';

function select(db: DatabaseSync, selected = query(), id = 'saved') {
	const definition = normalizePhotoSmartCollectionV1({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: CATALOG, id, revision: 2, name: 'Saved photographs', query: selected });
	insert(db, definition); db.prepare('INSERT INTO native_photo_smart_collection_states(catalog_id,revision,collection_count) VALUES(?,7,1)').run(CATALOG);
	return definition;
}
function collect(db: DatabaseSync, read: typeof ordinary) {
	const ids: string[] = [], pages: PhotoSavedQueryPageV1[] = []; let continuation: PhotoSavedQueryContinuationV1 | null = null;
	do {
		const page = read(db, CATALOG, 'saved', { continuation }); assert.ok(page.scanned <= 64 && pages.length < 200);
		assert.equal(db.isTransaction, false); assert.ok(page.items.length <= 64);
		assert.deepEqual(Object.keys(page).sort(), ['schemaVersion', 'kind', 'mode', 'catalogId', 'catalogName', 'totalCount', 'catalogRevision', 'indexRevision',
			'collectionId', 'collectionName', 'definitionRevision', 'collectionStateRevision', 'definitionSha256', 'querySha256', 'stackStateRevision', 'items', 'scanned', 'continuation'].sort());
		if (page.continuation) { assert.equal(Object.keys(page.continuation).length, 18); assert.ok(Buffer.byteLength(JSON.stringify(page.continuation)) <= 4096); }
		ids.push(...page.items.map(item => item.photoId)); pages.push(page); continuation = page.continuation;
	} while (continuation);
	return { ids, pages };
}

for (const field of ['photo-id', 'file-name', 'capture-time', 'rating'] as const) for (const direction of ['ascending', 'descending'] as const) {
	test(`Lightscaper native saved Query2 ${field} ${direction} preserves ordinary and filtered collapsed order without aggregates`, async () => {
		await fixture(db => {
			const f = seed(db, 130, { groups: [{ indices: [0, 1, 2, 3], cover: 1 }, { indices: [64, 65], cover: 64 }], patch: (p, i) => normalizePhotoDocumentCurrentV1({ ...p,
				metadata: { ...p.metadata, fileName: ['\ud800', '\udc00', '\ue000', '𐀀', 'Same', 'same'][i % 6], captureTime: i % 3 === 0 ? null : p.metadata.captureTime } }) });
			const selected = query({ filter: null, predicate: { kind: 'flag', value: 'pick' }, sort: { field, direction } }); select(db, selected); forbid(db);
			const matches = photoQueryMatcherV2(f.root, selected), ids = [...f.rows].sort((a, b) => compare(a, b, selected)).filter(matches).map(row => row.photoId);
			assert.ok(ids.length > 0); assert.deepEqual(collect(db, ordinary).ids, ids); assert.deepEqual(collect(db, collapsed).ids, expected(f, selected));
		});
	});
}

test('Lightscaper native saved Query2 owns recipes, closed admission and detached nested progress before SQL', async () => {
	await fixture(db => {
		seed(db, 130); select(db); const first = ordinary(db, CATALOG, 'saved'); assert.ok(first.continuation);
		const borrowed = { continuation: { ...first.continuation, sort: { ...first.continuation.sort } } }, packet = admit(CATALOG, 'saved', 'ordinary', borrowed);
		borrowed.continuation.sort.direction = 'descending'; assert.equal(readAdmitted(db, packet).items[0]?.photoId, photoId(64));
		assert.throws(() => readAdmitted(db, { ...packet })); assert.throws(() => ordinary(db, CATALOG, 'saved', { query: query() } as never));
		let getter = 0; assert.throws(() => ordinary(db, CATALOG, 'saved', { get continuation() { getter++; return first.continuation; } })); assert.equal(getter, 0);
	});
});

test('Lightscaper native saved Query2 authenticates before BEGIN and rejects cross-selection/mode/connection without changing a transaction', async () => {
	await fixture((db, path) => {
		seed(db, 130); select(db); const token = ordinary(db, CATALOG, 'saved').continuation!;
		let begins = 0; const original = db.exec; db.exec = function (sql) { if (sql === 'BEGIN') begins++; return original.call(db, sql); };
		try {
			assert.throws(() => ordinary(db, CATALOG, 'saved', { continuation: { ...token, afterKey: [CATALOG, photoId(99)] } }));
			assert.throws(() => collapsed(db, CATALOG, 'saved', { continuation: token })); assert.throws(() => ordinary(db, CATALOG, 'other', { continuation: token })); assert.equal(begins, 0);
			const second = new DatabaseSync(path); try { assert.throws(() => ordinary(second, CATALOG, 'saved', { continuation: token })); } finally { second.close(); }
		} finally { db.exec = original; }
	});
});

for (const mode of ['ordinary', 'collapsed'] as const) test(`Lightscaper native saved ${mode} stale selection fence precedes Query2 readiness`, async () => {
	await fixture(db => {
		seed(db, 130); select(db); const read = mode === 'ordinary' ? ordinary : collapsed, token = read(db, CATALOG, 'saved').continuation!;
		db.exec('DELETE FROM native_photo_query_builds_v2');
		assert.throws(() => read(db, CATALOG, 'saved'), PhotoQueryIndexNotReadyError);
		db.exec('UPDATE native_photo_smart_collection_states SET revision=revision+1');
		assert.throws(() => read(db, CATALOG, 'saved', { continuation: token }), PhotoSmartCollectionRevisionConflictError); assert.equal(db.isTransaction, false);
	});
});

test('Lightscaper native saved collapsed pending traversal shares the64 ledger and authenticates its1024-member closure', async () => {
	await fixture(db => {
		const f = seed(db, 1024, { groups: [{ indices: Array.from({ length: 1024 }, (_, i) => i), cover: 0 }] }); select(db); forbid(db);
		const watched = observe(db);
		try {
			const first = collapsed(db, CATALOG, 'saved'); assert.equal(first.items.length, 0); assert.ok(first.continuation?.pending);
			assert.equal(watched.delivered.length + watched.audited, first.scanned); assert.ok(first.scanned <= 64);
			assert.deepEqual(collect(db, collapsed).ids, expected(f, query()));
			db.prepare('DELETE FROM native_photo_stack_memberships WHERE photo_key=?').run(`${CATALOG}|${photoId(0)}`);
			assert.throws(() => collect(db, collapsed), /membership|forward|reverse|stack/iu);
		} finally { watched.restore(); }
	});
});

test('Lightscaper native saved Query2 uses one WAL snapshot for root, definition, build and page', async () => {
	await fixture((db, path) => {
		seed(db, 2); select(db); const second = new DatabaseSync(path), prepare = db.prepare; let changed = false;
		db.prepare = function (...args: Parameters<typeof prepare>) {
			const statement = prepare.apply(db, args);
			if (/FROM native_photo_catalogs/iu.test(args[0])) { const get = statement.get; statement.get = (...values: unknown[]) => {
				const row = Reflect.apply(get, statement, values) as ReturnType<typeof get>; if (!changed) { changed = true; second.exec('BEGIN IMMEDIATE; UPDATE native_photo_smart_collection_states SET revision=8; COMMIT'); } return row;
			}; } return statement;
		};
		try { assert.equal(ordinary(db, CATALOG, 'saved').collectionStateRevision, 7); assert.equal(ordinary(db, CATALOG, 'saved').collectionStateRevision, 8); }
		finally { db.prepare = prepare; second.close(); }
	});
});

test('Lightscaper native saved Query2 refuses malformed persisted query projection and opaque abort without getters', async () => {
	await fixture(db => {
		seed(db, 2); select(db); const stop = new AbortController(); let traps = 0;
		const reason = new Proxy({}, { get() { traps++; throw Error('Opaque reason'); }, getPrototypeOf() { traps++; throw Error('Opaque reason'); } }); stop.abort(reason);
		try { ordinary(db, CATALOG, 'saved', { signal: stop.signal }); assert.fail('Must abort'); } catch (error) { assert.equal(error, reason); } assert.equal(traps, 0);
		db.prepare('UPDATE native_photo_query_rows_v2 SET row_json=? WHERE photo_id=?').run('{}', photoId(0)); assert.throws(() => ordinary(db, CATALOG, 'saved')); assert.equal(db.isTransaction, false);
	});
});
