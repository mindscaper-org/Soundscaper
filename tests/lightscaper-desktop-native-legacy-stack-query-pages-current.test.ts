/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { constants } from 'node:sqlite';
import test from 'node:test';
import { readLightscaperNativeLegacyStackQueryPageCurrentV1 as read } from '../desktop/lightscaper-native-legacy-stack-query-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import type { PhotoStackQueryContinuationV1 } from '../src/lightscaper/catalog/photo-stack-query-types-v1.ts';
import { CATALOG, photoId, legacyQueryFixtureCurrentV1 as fixture, seedNativeLegacyQueryCurrentV1 as seed, legacyQueryCurrentV1 as query } from './helpers/lightscaper-native-legacy-query-fixture-current.ts';
import { expectedNativeLegacyStackQueryCurrentV1 as expected, collectNativeLegacyStackQueryCurrentV1 as collect, observeNativeLegacyStackQueryReadsCurrentV1 as observe } from './helpers/lightscaper-native-legacy-stack-query-fixture-current.ts';
import { forbidNativeStackQueryAggregatesCurrentV1 as forbid } from './helpers/lightscaper-native-stack-query-fixture-current.ts';

const NAMES = ['A.jpg', 'same.jpg', 'İ.jpg', '😀.jpg', '\uE000.jpg', '💡.jpg', 'é.jpg', 'Z.jpg', '\ud800.jpg', '\udc00.jpg'];
const allIndices = (count: number) => Array.from({ length: count }, (_, index) => index);

test('Lightscaper native legacy collapsed Query1 keeps exact five-field pages and globally ordered covers for every sort and Unicode tie', async () => {
	await fixture(database => {
		const f = seed(database, 130, { groups: [{ indices: [0, 64, 129], cover: 129 }, { indices: [100, 30, 10], cover: 100 }],
			patch: (photo, index) => normalizePhotoDocumentCurrentV1({ ...photo, metadata: { ...photo.metadata, fileName: NAMES[index % NAMES.length] } }) }); forbid(database);
		for (const field of ['photo-id', 'file-name', 'capture-time', 'rating'] as const) for (const direction of ['ascending', 'descending'] as const) {
			const selected = query({ sort: { field, direction } }), result = collect(database, selected, read);
			assert.deepEqual(result.ids, expected(f, selected)); assert.equal(new Set(result.ids).size, 126);
			for (const page of result.pages) {
				assert.deepEqual(Object.keys(page).sort(), ['catalogName', 'continuation', 'items', 'scanned', 'totalCount']);
				assert.equal(page.catalogName, f.root.name); assert.equal(page.totalCount, 130); assert.equal(Object.isFrozen(page), true); assert.equal(Object.isFrozen(page.items), true);
				if (page.continuation) assert.deepEqual(Object.keys(page.continuation).sort(), ['schemaVersion', 'kind', 'catalogId', 'catalogRevision', 'indexRevision', 'stateRevision', 'querySha256', 'captureBucket', 'afterKey', 'pending', 'stackAudit', 'progressSha256'].sort());
			}
		}
		assert.ok('😀.jpg' < '\uE000.jpg');
	});
});

test('Lightscaper native legacy collapsed Query1 filtered cover fallback follows global tuple rather than declared member order', async () => {
	await fixture(database => {
		const f = seed(database, 130, { groups: [{ indices: [64, 129, 0], cover: 129 }], patch: (photo, index) => normalizePhotoDocumentCurrentV1({ ...photo, rating: index === 129 ? 5 : 4 }) }); forbid(database);
		for (const field of ['photo-id', 'file-name', 'capture-time', 'rating'] as const) for (const direction of ['ascending', 'descending'] as const) {
			const selected = query({ filter: { kind: 'rating', value: 4 }, sort: { field, direction } }), result = collect(database, selected, read);
			assert.deepEqual(result.ids, expected(f, selected)); assert.equal(result.ids.includes(photoId(129)), false);
			assert.equal(result.ids.filter(id => [photoId(0), photoId(64)].includes(id)).length, 1);
		}
		assert.deepEqual(collect(database, query({ filter: { kind: 'rating', value: 3 } }), read).ids, []);
	});
});

test('Lightscaper native legacy collapsed Query1 preserves original filter and live keyword-text semantics without Query2 readiness', async () => {
	await fixture(database => {
		const f = seed(database, 130, { groups: [{ indices: [0, 64, 129], cover: 129 }] });
		database.exec('UPDATE native_photo_query_builds_v2 SET ready=0; DELETE FROM native_photo_query_rows_v2');
		database.setAuthorizer((action, table) => action === constants.SQLITE_READ && (table === 'native_photo_query_rows_v2' || table === 'native_photo_query_builds_v2') ? constants.SQLITE_DENY : constants.SQLITE_OK);
		for (const selected of [query(), query({ text: 'LANDSCAPE' }), query({ text: 'Sparse token' }),
			...([{ kind: 'folder', id: 'folder' }, { kind: 'keyword', id: 'keyword' }, { kind: 'collection', id: 'manual' }, { kind: 'collection', id: 'smart' },
				{ kind: 'rating', value: 5 }, { kind: 'flag', value: 'pick' }, { kind: 'label', value: 'blue' }].map(filter => query({ filter })))]) {
			const wanted = expected(f, selected); assert.ok(wanted.length > 0); assert.deepEqual(collect(database, selected, read).ids, wanted);
		}
		assert.throws(() => read(database, CATALOG, { query: query({ filter: { kind: 'keyword', id: 'missing' } }) }), ReferenceError);
	});
});

test('Lightscaper native legacy collapsed Query1 scans sparse candidates and exact64 tails and crosses capture buckets within one ledger', async () => {
	await fixture(database => { seed(database); const result = collect(database, query({ text: 'Sparse token' }), read); assert.deepEqual(result.ids, [photoId(129)]); assert.deepEqual(result.pages.map(page => page.scanned), [64, 64, 2]); });
	await fixture(database => { seed(database, 64); const result = collect(database, query(), read); assert.deepEqual(result.pages.map(page => page.scanned), [64, 0]); });
	for (const direction of ['ascending', 'descending'] as const) await fixture(database => {
		const f = seed(database, 5, { patch: (photo, index) => normalizePhotoDocumentCurrentV1({ ...photo, metadata: { ...photo.metadata, captureTime: index < 2 ? { local: '2026-01-01T12:00:00.000', offsetMinutes: null } : null } }) });
		const selected = query({ sort: { field: 'capture-time', direction } }), first = read(database, CATALOG, { query: selected });
		assert.equal(first.scanned, 5); assert.equal(first.continuation, null); assert.deepEqual(first.items.map(row => row.photoId), expected(f, selected)); assert.ok(first.items.slice(-3).every(row => row.captureLocal === null));
	});
});

test('Lightscaper native legacy collapsed Query1 uses one observed64 budget for initial keys global candidates and pending member probes', async () => {
	await fixture(database => {
		seed(database, 130, { groups: [{ indices: allIndices(130), cover: 0 }] }); forbid(database); const ledger = observe(database);
		let continuation: PhotoStackQueryContinuationV1 | null = null, winner = false;
		try {
			for (let step = 0; step < 8 && !winner; step++) {
				const before = ledger.delivered.length, audited = ledger.audited, page = read(database, CATALOG, { continuation });
				assert.equal(page.scanned, ledger.delivered.length - before + ledger.audited - audited); assert.ok(page.scanned <= 64);
				if (step === 0) { assert.deepEqual(page.items, []); assert.ok(page.continuation?.pending); assert.equal(page.scanned, 64); }
				winner = page.items.some(row => row.photoId === photoId(0)); continuation = page.continuation;
			}
			assert.equal(winner, true); assert.equal(new Set(ledger.delivered).size, 130);
		} finally { ledger.restore(); }
	});
	for (const count of [64, 65]) await fixture(database => {
		seed(database, count * 2, { groups: allIndices(count).map(index => ({ indices: [index * 2, index * 2 + 1], cover: index * 2 })) }); forbid(database); const ledger = observe(database);
		try {
			const first = read(database, CATALOG); assert.deepEqual(first.items, []); assert.equal(first.scanned, 64); assert.equal(first.continuation?.stackAudit?.count, 64); assert.equal(ledger.delivered.length, 0);
			const before = ledger.delivered.length, audited = ledger.audited, next = read(database, CATALOG, { continuation: first.continuation });
			assert.equal(next.scanned, ledger.delivered.length - before + ledger.audited - audited); assert.ok(next.items.length > 0);
		} finally { ledger.restore(); }
	});
});

test('Lightscaper native legacy collapsed Query1 authenticates maximum1024 members through signed empty steps before cover emission', async () => {
	await fixture(database => {
		seed(database, 1024, { groups: [{ indices: allIndices(1024).reverse(), cover: 0 }] }); forbid(database); const ledger = observe(database);
		let continuation: PhotoStackQueryContinuationV1 | null = null, winner: boolean, steps = 0;
		try {
			do {
				const before = ledger.delivered.length, audited = ledger.audited, page = read(database, CATALOG, { continuation });
				assert.equal(page.scanned, ledger.delivered.length - before + ledger.audited - audited); assert.ok(page.scanned <= 64);
				winner = page.items.some(row => row.photoId === photoId(0)); continuation = page.continuation; steps++;
				if (!winner) { assert.deepEqual(page.items, []); assert.ok(continuation?.pending); assert.ok(steps < 25); }
			} while (!winner && continuation);
			assert.equal(winner, true); assert.ok(steps >= 17); assert.equal(new Set(ledger.delivered).size, 1024);
		} finally { ledger.restore(); }
	});
});

test('Lightscaper native legacy collapsed Query1 reversed maximum fallback keeps unknown dates last in both directions', async () => {
	for (const direction of ['ascending', 'descending'] as const) await fixture(database => {
		const f = seed(database, 1024, { groups: [{ indices: allIndices(1024).reverse(), cover: 1023 }], patch: (photo, index) => normalizePhotoDocumentCurrentV1({ ...photo, rating: index === 1023 ? 5 : 4 }) }); forbid(database);
		const selected = query({ filter: { kind: 'rating', value: 4 }, sort: { field: 'capture-time', direction } }), wanted = expected(f, selected); assert.equal(wanted.length, 1);
		let continuation: PhotoStackQueryContinuationV1 | null = null, winner: string | undefined, steps = 0;
		do { const page = read(database, CATALOG, { query: selected, continuation }); assert.ok(page.scanned <= 64); winner = page.items[0]?.photoId; continuation = page.continuation; steps++; if (!winner) { assert.ok(continuation?.pending); assert.ok(steps < 25); } } while (!winner && continuation);
		assert.equal(winner, wanted[0]); assert.ok(steps >= 17);
	});
});

test('Lightscaper native legacy collapsed Query1 folded512 filename emits its own bounded reusable signed cursor', async () => {
	await fixture(database => {
		const fileName = 'İ'.repeat(256); seed(database, 65, { patch: photo => normalizePhotoDocumentCurrentV1({ ...photo, metadata: { ...photo.metadata, fileName } }) });
		const selected = query({ sort: { field: 'file-name', direction: 'ascending' } }), first = read(database, CATALOG, { query: selected });
		assert.equal(first.continuation?.afterKey?.[1], fileName.toLowerCase()); const next = read(database, CATALOG, { query: selected, continuation: first.continuation });
		assert.deepEqual(next.items.map(row => row.photoId), [photoId(64)]); assert.equal(next.continuation, null);
	});
});
