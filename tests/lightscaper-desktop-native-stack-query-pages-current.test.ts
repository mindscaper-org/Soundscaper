/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readLightscaperNativeStackQueryPageCurrentV1 as read } from '../desktop/lightscaper-native-stack-query-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { photoQueryMatcherV2 } from '../src/lightscaper/catalog/photo-query-matcher-v2.ts';
import type { PhotoStackQueryContinuationV2 } from '../src/lightscaper/catalog/photo-stack-query-types-v2.ts';
import { CATALOG, photoId, nativeStackQueryFixtureCurrentV1 as fixture, seedNativeStackQueryCurrentV1 as seed,
	stackQueryCurrentV1 as query, expectedNativeStackQueryCurrentV1 as expected, collectNativeStackQueryCurrentV1 as collect,
	forbidNativeStackQueryAggregatesCurrentV1 as forbid, observeNativeStackQueryReadsCurrentV1 as observe } from './helpers/lightscaper-native-stack-query-fixture-current.ts';

const NAMES = ['A.jpg', 'same.jpg', 'İ.jpg', '😀.jpg', '\uE000.jpg', '💡.jpg', 'é.jpg', 'Z.jpg', '\ud800.jpg', '\udc00.jpg'];

test('Lightscaper native collapsed Query2 places matching covers globally for every sort direction and UTF16 ties', async () => {
	await fixture(database => {
		const f = seed(database, 130, { groups: [{ indices: [0, 64, 129], cover: 129 }, { indices: [100, 30, 10], cover: 100 }],
			patch: (value, index) => normalizePhotoDocumentCurrentV1({ ...value, metadata: { ...value.metadata, fileName: NAMES[index % NAMES.length] } }) });
		forbid(database);
		for (const field of ['photo-id', 'file-name', 'capture-time', 'rating'] as const) for (const direction of ['ascending', 'descending'] as const) {
			const selected = query({ sort: { field, direction } }), result = collect(database, selected, read);
			assert.deepEqual(result.ids, expected(f, selected)); assert.equal(result.ids.length, 126); assert.equal(new Set(result.ids).size, 126);
			for (const page of result.pages) {
				assert.deepEqual(Object.keys(page).sort(), ['schemaVersion', 'kind', 'catalogId', 'catalogName', 'totalCount', 'catalogRevision', 'indexRevision', 'stateRevision', 'items', 'scanned', 'continuation'].sort());
				assert.equal(page.schemaVersion, 2); assert.equal(page.kind, 'collapsed-photo-query-page'); assert.equal(page.catalogId, CATALOG);
				assert.equal(page.catalogName, f.root.name); assert.equal(page.totalCount, 130); assert.equal(page.catalogRevision, 3);
				assert.equal(page.indexRevision, 11); assert.equal(page.stateRevision, 5); assert.equal(Object.isFrozen(page), true); assert.equal(Object.isFrozen(page.items), true);
			}
		}
		assert.ok('😀.jpg' < '\uE000.jpg', 'Fixture separates UTF16 order from UTF8 text collation.');
	});
});

test('Lightscaper native collapsed Query2 filtered cover falls back by global tuple instead of stored member order', async () => {
	await fixture(database => {
		const f = seed(database, 130, { groups: [{ indices: [64, 129, 0], cover: 129 }] }); forbid(database);
		for (const field of ['photo-id', 'file-name', 'capture-time', 'rating'] as const) for (const direction of ['ascending', 'descending'] as const) {
			const selected = query({ sort: { field, direction }, predicate: { kind: 'number', column: 'iso', minimum: 200, maximum: 200 } });
			const result = collect(database, selected, read); assert.deepEqual(result.ids, expected(f, selected));
			assert.equal(result.ids.includes(photoId(129)), false); assert.equal(result.ids.filter(id => [photoId(0), photoId(64)].includes(id)).length, 1);
		}
		const none = query({ predicate: { kind: 'number', column: 'iso', minimum: 1600, maximum: 3200 } }); assert.deepEqual(collect(database, none, read).ids, []);
	});
});

test('Lightscaper native collapsed Query2 preserves all shared filters text and nested metadata eligibility', async () => {
	await fixture(database => {
		const f = seed(database, 130, { groups: [{ indices: [0, 64, 129], cover: 129 }] }); forbid(database);
		const selections = [
			...([{ kind: 'folder', id: 'folder' }, { kind: 'keyword', id: 'keyword' }, { kind: 'collection', id: 'manual' },
				{ kind: 'collection', id: 'smart' }, { kind: 'rating', value: 5 }, { kind: 'flag', value: 'pick' }, { kind: 'label', value: 'blue' }].map(filter => query({ filter }))),
			query({ text: 'LANDSCAPE' }), query({ text: 'Sparse token' }), query({ predicate: { kind: 'all', terms: [
				{ kind: 'any', terms: [{ kind: 'text', column: 'camera-make', operator: 'equals', value: 'Canon' }, { kind: 'number', column: 'iso', minimum: 200, maximum: 200 }] },
				{ kind: 'not', term: { kind: 'presence', column: 'iso', value: 'unknown' } },
				{ kind: 'text', column: 'copyright', operator: 'contains', value: 'CAFÉ' },
			] } }),
		];
		for (const selected of selections) {
			const wanted = expected(f, selected); assert.ok(wanted.length > 0); assert.deepEqual(collect(database, selected, read).ids, wanted);
		}
		const missing = query({ predicate: { kind: 'any', terms: [{ kind: 'presence', column: 'title', value: 'known' }, { kind: 'keyword', id: 'missing' }] } });
		const observations = observe(database);
		try { assert.throws(() => read(database, CATALOG, { query: missing }), ReferenceError); assert.deepEqual(observations.delivered, []); }
		finally { observations.restore(); }
		assert.ok(f.rows.some(photoQueryMatcherV2(f.root, query({ text: 'Sparse token' }))));
	});
});

test('Lightscaper native collapsed Query2 sparse full64 and capture-bucket exhaustion keep legal empty continuations', async () => {
	await fixture(database => {
		seed(database); const result = collect(database, query({ text: 'Sparse token' }), read);
		assert.deepEqual(result.ids, [photoId(129)]); assert.deepEqual(result.pages.map(page => page.scanned), [64, 64, 2]);
		assert.deepEqual(result.pages.map(page => page.items.length), [0, 0, 1]);
	});
	await fixture(database => {
		seed(database, 64); const result = collect(database, query(), read); assert.deepEqual(result.pages.map(page => page.scanned), [64, 0]);
	});
	for (const direction of ['ascending', 'descending'] as const) await fixture(database => {
		const f = seed(database, 5, { patch: (value, index) => normalizePhotoDocumentCurrentV1({ ...value, metadata: { ...value.metadata,
			captureTime: index < 2 ? { local: '2026-01-01T12:00:00.000', offsetMinutes: null } : null } }) });
		const selected = query({ sort: { field: 'capture-time', direction } }), first = read(database, CATALOG, { query: selected });
		assert.equal(first.scanned, 5); assert.equal(first.continuation, null); assert.deepEqual(first.items.map(row => row.photoId), expected(f, selected));
		assert.ok(first.items.slice(-3).every(row => row.captureLocal === null));
	});
});

test('Lightscaper native collapsed Query2 uses one shared64 ledger for stack-key audit sequential candidates and point probes', async () => {
	await fixture(database => {
		seed(database, 130, { groups: [{ indices: Array.from({ length: 130 }, (_, index) => index), cover: 0 }] }); forbid(database);
		const observed = observe(database); let continuation: PhotoStackQueryContinuationV2 | null = null, winner = false;
		try {
			for (let step = 0; step < 8 && !winner; step++) {
				const before = observed.delivered.length, auditBefore = observed.audited, page = read(database, CATALOG, { continuation });
				assert.equal(page.scanned, observed.delivered.length - before + observed.audited - auditBefore); assert.ok(page.scanned <= 64);
				if (step === 0) { assert.deepEqual(page.items, []); assert.ok(page.continuation?.pending); assert.equal(page.scanned, 64); }
				winner = page.items.some(row => row.photoId === photoId(0)); continuation = page.continuation;
			}
			assert.equal(winner, true); assert.ok(observed.delivered.includes(photoId(129)));
		} finally { observed.restore(); }
	});
	for (const count of [64, 65]) await fixture(database => {
		const groups = Array.from({ length: count }, (_, index) => ({ indices: [index * 2, index * 2 + 1], cover: index * 2 }));
		seed(database, count * 2, { groups }); forbid(database); const observed = observe(database);
		try {
			const first = read(database, CATALOG); assert.equal(first.scanned, 64); assert.deepEqual(first.items, []);
			assert.equal(first.continuation?.stackAudit?.count, 64); assert.equal(first.continuation?.pending, null); assert.equal(observed.delivered.length, 0); assert.equal(observed.audited, 64);
			const before = observed.delivered.length, auditBefore = observed.audited, second = read(database, CATALOG, { continuation: first.continuation });
			assert.equal(second.scanned, observed.delivered.length - before + observed.audited - auditBefore); assert.ok(second.items.length > 0);
		} finally { observed.restore(); }
	});
});

test('Lightscaper native collapsed Query2 completes maximum1024 pending closure before emitting its eligible cover', async () => {
	await fixture(database => {
		seed(database, 1024, { groups: [{ indices: Array.from({ length: 1024 }, (_, index) => index).reverse(), cover: 0 }] }); forbid(database);
		const observed = observe(database); let continuation: PhotoStackQueryContinuationV2 | null = null, steps = 0;
		let winner: boolean;
		try {
			do {
				const before = observed.delivered.length, auditBefore = observed.audited, page = read(database, CATALOG, { continuation });
				assert.equal(page.scanned, observed.delivered.length - before + observed.audited - auditBefore); assert.ok(page.scanned <= 64);
				winner = page.items.some(row => row.photoId === photoId(0)); continuation = page.continuation; steps++;
				if (!winner) { assert.deepEqual(page.items, []); assert.ok(continuation?.pending); assert.ok(steps < 25); }
			} while (!winner && continuation);
			assert.equal(winner, true); assert.ok(steps >= 17); assert.equal(new Set(observed.delivered).size, 1024);
		} finally { observed.restore(); }
	});
});

test('Lightscaper native collapsed Query2 maximum reversed fallback uses dated-before-unknown global order in either direction', async () => {
	for (const direction of ['ascending', 'descending'] as const) await fixture(database => {
		const f = seed(database, 1024, { groups: [{ indices: Array.from({ length: 1024 }, (_, index) => index).reverse(), cover: 1023 }] }); forbid(database);
		const selected = query({ sort: { field: 'capture-time', direction }, predicate: { kind: 'number', column: 'iso', minimum: 200, maximum: 200 } });
		const wanted = expected(f, selected); assert.equal(wanted.length, 1);
		let continuation: PhotoStackQueryContinuationV2 | null = null, winner: string | undefined, steps = 0;
		do {
			const page = read(database, CATALOG, { query: selected, continuation }); assert.ok(page.scanned <= 64); winner = page.items[0]?.photoId;
			continuation = page.continuation; steps++; if (!winner) { assert.ok(continuation?.pending); assert.ok(steps < 25); }
		} while (!winner && continuation);
		assert.equal(winner, wanted[0]); assert.ok(steps >= 17);
	});
});

test('Lightscaper native collapsed Query2 supports folded512-unit filename continuations', async () => {
	await fixture(database => {
		const fileName = 'İ'.repeat(256); seed(database, 65, { patch: value => normalizePhotoDocumentCurrentV1({ ...value, metadata: { ...value.metadata, fileName } }) });
		const selected = query({ sort: { field: 'file-name', direction: 'ascending' } }), first = read(database, CATALOG, { query: selected });
		assert.equal(first.continuation?.afterKey?.[1], fileName.toLowerCase());
		const next = read(database, CATALOG, { query: selected, continuation: first.continuation }); assert.deepEqual(next.items.map(row => row.photoId), [photoId(64)]);
		assert.equal(next.continuation, null);
	});
});
