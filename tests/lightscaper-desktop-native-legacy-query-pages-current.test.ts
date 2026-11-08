/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { constants, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { admitLightscaperNativeLegacyQueryPageCurrentV1 as admit, readAdmittedLightscaperNativeLegacyQueryPageCurrentV1 as admittedRead,
	readLightscaperNativeLegacyQueryPageCurrentV1 as read, readLightscaperNativeLegacyQueryInTransactionCurrentV1 as inclusiveRead } from '../desktop/lightscaper-native-legacy-query-pages-current-v1.ts';
import { readLightscaperNativeCatalogRowCurrentV1 } from '../desktop/lightscaper-native-catalog-records-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { photoQueryMatcherV1 } from '../src/lightscaper/catalog/photo-query-matcher-v1.ts';
import { photoQueryRowKeyV1, type PhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { readPhotoQueryContinuationV1, type PhotoCatalogQueryV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import { legacyQueryFixtureCurrentV1 as fixture, seedNativeLegacyQueryCurrentV1 as seed, legacyQueryCurrentV1 as query,
	collectLegacyQueryCurrentV1 as collect, putLegacyQueryRowCurrentV1 as put, replaceLegacyQuerySourceCurrentV1 as source, CATALOG, key } from './helpers/lightscaper-native-legacy-query-fixture-current.ts';
import { projectPhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { writeNativeStackQueryRowCurrentV1 } from './helpers/lightscaper-native-stack-query-fixture-current.ts';

function compare(a: PhotoQueryRowV1, b: PhotoQueryRowV1, q: PhotoCatalogQueryV1): number {
	if (q.sort.field === 'capture-time' && a.captureBucket !== b.captureBucket) return a.captureBucket - b.captureBucket;
	const x = photoQueryRowKeyV1(a, q.sort.field), y = photoQueryRowKeyV1(b, q.sort.field);
	for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return (x[i]! < y[i]! ? -1 : 1) * (q.sort.direction === 'ascending' ? 1 : -1);
	return 0;
}

test('Lightscaper native legacy ordinary pages preserve all sorts UTF16 ties filters and exact V1 envelopes without aggregate reads', async () => {
	await fixture(db => {
		const names = ['A.jpg', 'same.jpg', 'İ.jpg', '😀.jpg', '\uE000.jpg', '\ud800.jpg', '\udc00.jpg'];
		const f = seed(db, 130, { patch: (p, i) => normalizePhotoDocumentCurrentV1({ ...p, metadata: { ...p.metadata, fileName: names[i % names.length] } }) });
		db.setAuthorizer((action, table, column) => action === constants.SQLITE_READ && table === 'native_photos' && column === 'document'
			|| action === constants.SQLITE_FUNCTION && column?.toLowerCase() === 'count' ? constants.SQLITE_DENY : constants.SQLITE_OK);
		for (const field of ['photo-id', 'file-name', 'capture-time', 'rating'] as const) for (const direction of ['ascending', 'descending'] as const) {
			const q = query({ sort: { field, direction } }), result = collect(db, q, read);
			assert.deepEqual(result.ids, [...f.legacyRows].sort((a, b) => compare(a, b, q)).map(row => row.photoId));
			assert.equal(new Set(result.ids).size, 130);
		}
		for (const q of [query({ text: 'LANDSCAPE' }), query({ text: 'Sparse token' }), query({ filter: { kind: 'collection', id: 'smart' } }),
			query({ filter: { kind: 'folder', id: 'folder' } }), query({ filter: { kind: 'flag', value: 'pick' } })]) {
			assert.deepEqual(collect(db, q, read).ids, f.legacyRows.filter(photoQueryMatcherV1(f.root, q)).map(row => row.photoId));
		}
		const page = read(db, CATALOG); assert.deepEqual(Object.keys(page).sort(), ['continuation', 'items', 'scanned']);
		assert.ok(page.continuation); assert.deepEqual(Object.keys(page.continuation).sort(), ['afterKey','captureBucket','catalogId','indexRevision','querySha256','schemaVersion']);
		assert.deepEqual(readPhotoQueryContinuationV1(page.continuation, CATALOG, query()), page.continuation);
	});
});

test('Lightscaper native legacy sparse exact64 and capture bucket transitions preserve truthful empty steps', async () => {
	await fixture(db => { seed(db, 130); const result = collect(db, query({ text: 'Sparse token' }), read);
		assert.deepEqual(result.pages.map(p => p.scanned), [64,64,2]); assert.deepEqual(result.pages.map(p => p.items.length), [0,0,1]); });
	await fixture(db => { seed(db, 64); assert.deepEqual(collect(db, query(), read).pages.map(p => p.scanned), [64,0]); });
	for (const direction of ['ascending','descending'] as const) await fixture(db => {
		seed(db, 65, { patch: (p, i) => normalizePhotoDocumentCurrentV1({ ...p, metadata: { ...p.metadata,
			captureTime: i === 64 ? null : { local: '2026-01-01T12:00:00.000', offsetMinutes: null } } }) });
		const result = collect(db, query({ sort: { field: 'capture-time', direction } }), read);
		assert.deepEqual(result.pages.map(p => p.scanned), [64,0,1]); assert.equal(result.ids.at(-1), 'photo-000064');
		assert.equal(result.pages[1]?.continuation?.captureBucket, 1); assert.equal(result.pages[1]?.continuation?.afterKey, null);
	});
});

test('Lightscaper native legacy folded maximum filename emits a reusable bounded V1 position', async () => {
	await fixture(db => {
		const fileName = 'İ'.repeat(256); seed(db, 65, { patch: p => normalizePhotoDocumentCurrentV1({ ...p, metadata: { ...p.metadata, fileName } }) });
		const q = query({ sort: { field: 'file-name', direction: 'ascending' } }), first = read(db, CATALOG, { query: q });
		assert.equal(first.continuation?.afterKey?.[1], fileName.toLowerCase()); assert.ok(Buffer.byteLength(JSON.stringify(first.continuation)) <= 2048);
		assert.equal(read(db, CATALOG, { query: q, continuation: first.continuation }).items[0]?.photoId, 'photo-000064');
	});
});

for (const ready of [false, true]) test(`Lightscaper native legacy stale index precedes ${ready ? 'missing' : 'unready'} readiness`, async () => {
	await fixture(db => {
		seed(db, 65); const first = read(db, CATALOG); db.exec('UPDATE native_photo_catalogs SET index_revision=12');
		if (ready) db.exec('DELETE FROM native_photo_query_builds_v1'); else db.exec('UPDATE native_photo_query_builds_v1 SET ready=0');
		assert.throws(() => read(db, CATALOG, { continuation: first.continuation }), { code: 'CATALOG_REVISION_CONFLICT' });
		assert.throws(() => read(db, CATALOG), { code: 'PHOTO_QUERY_INDEX_NOT_READY' }); assert.equal(db.isTransaction, false);
	});
});

test('Lightscaper native legacy admission is captured closed and branded and native cancellation releases its snapshot', async () => {
	await fixture(db => {
		seed(db, 2); const borrowed = { text: 'missing' }, request = admit(CATALOG, { query: borrowed }); borrowed.text = 'Ordinary';
		assert.equal(admittedRead(db, request).items.length, 0); assert.throws(() => admittedRead(db, { ...request })); let calls = 0;
		assert.throws(() => admit(CATALOG, { get query() { calls++; return {}; } })); assert.equal(calls, 0);
		assert.throws(() => admit(CATALOG, { position: { captureBucket: 0, afterKey: null } }));
		assert.throws(() => admit(CATALOG, { query: { schemaVersion: 2, kind: 'photo-catalog-query' } }));
		db.exec('BEGIN'); try { assert.throws(() => read(db, CATALOG), /transaction|snapshot/iu); } finally { db.exec('ROLLBACK'); }
		const stop = new AbortController(); let traps = 0;
		const reason = new Proxy({}, { get() { traps++; throw Error('Opaque'); }, getPrototypeOf() { traps++; throw Error('Opaque'); } });
		db.setAuthorizer((action, table) => { if (action === constants.SQLITE_READ && table === 'native_photo_query_rows_v1') stop.abort(reason); return constants.SQLITE_OK; });
		let failure: unknown; try { read(db, CATALOG, { signal: stop.signal }); } catch (error) { failure = error; }
		assert.equal(failure, reason); assert.equal(traps, 0); assert.equal(db.isTransaction, false); db.setAuthorizer(null);
	});
});

test('Lightscaper native legacy private inclusive seam includes an actual point while public positions remain exclusive', async () => {
	await fixture(db => {
		const f = seed(db, 3), q = query(); db.exec('BEGIN');
		try {
			const raw = db.prepare('SELECT id,document,root_revision,photo_count,index_revision FROM native_photo_catalogs WHERE id=?').get(CATALOG);
			const { root, index } = readLightscaperNativeCatalogRowCurrentV1(raw, CATALOG), position = { captureBucket: 0 as const, key: photoQueryRowKeyV1(f.legacyRows[1]!, q.sort.field) };
			assert.deepEqual(inclusiveRead(db, root, index, q, null, undefined, position).items.map(p => p.photoId), ['photo-000001','photo-000002']);
		} finally { db.exec('ROLLBACK'); }
	});
});

test('Lightscaper native legacy root build and derived rows retain one WAL snapshot across actual competing publication', async () => {
	await fixture((db, path) => {
		const f = seed(db, 2), writer = new DatabaseSync(path); let changed = false;
		try {
			db.setAuthorizer((action, table) => {
				if (!changed && action === constants.SQLITE_READ && table === 'native_photo_query_rows_v1') {
					changed = true; const next = normalizePhotoDocumentCurrentV1({ ...f.photos[0]!, revision: 1, rating: 5 }); writer.exec('BEGIN IMMEDIATE');
					writer.prepare('UPDATE native_photo_catalogs SET index_revision=12 WHERE id=?').run(CATALOG); source(writer, next);
					put(writer, projectPhotoQueryRowV1(next)); writeNativeStackQueryRowCurrentV1(writer, projectPhotoQueryRowV2(next)); writer.exec('COMMIT');
				} return constants.SQLITE_OK;
			});
			assert.equal(read(db, CATALOG).items[0]?.photoRevision, 0); assert.equal(changed, true); db.setAuthorizer(null);
			assert.equal(read(db, CATALOG).items[0]?.photoRevision, 1); assert.equal(db.isTransaction, false);
		} finally { db.setAuthorizer(null); if (writer.isTransaction) writer.exec('ROLLBACK'); writer.close(); }
	});
});

test('Lightscaper native legacy corrupt sort projection fails only on its actual bounded page', async () => {
	await fixture(db => {
		seed(db, 130); db.prepare('UPDATE native_photo_query_rows_v1 SET row_json=? WHERE photo_key=?').run('{later', key(129));
		const first = read(db, CATALOG), second = read(db, CATALOG, { continuation: first.continuation }); assert.equal(second.scanned, 64);
		assert.throws(() => read(db, CATALOG, { continuation: second.continuation })); assert.equal(db.isTransaction, false);
		db.prepare('UPDATE native_photo_query_rows_v1 SET rating_sort=5 WHERE photo_key=?').run(key(0)); assert.throws(() => read(db, CATALOG));
	});
});
