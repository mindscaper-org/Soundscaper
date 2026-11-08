/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { readLightscaperNativeCullingDestinationPageCurrentV1 as destination } from '../desktop/lightscaper-native-culling-current-v1.ts';
import { readLightscaperNativeCatalogSummaryPageCurrentV1 as plainPage } from '../desktop/lightscaper-native-catalog-pages-current-v1.ts';
import { readLightscaperNativeLegacyQueryPageCurrentV1 as ordinaryV1 } from '../desktop/lightscaper-native-legacy-query-pages-current-v1.ts';
import { readLightscaperNativeQueryPageCurrentV1 as ordinaryV2 } from '../desktop/lightscaper-native-query-pages-current-v1.ts';
import { readLightscaperNativeLegacyStackQueryPageCurrentV1 as collapsedV1 } from '../desktop/lightscaper-native-legacy-stack-query-current-v1.ts';
import { readLightscaperNativeStackQueryPageCurrentV1 as collapsedV2 } from '../desktop/lightscaper-native-stack-query-current-v1.ts';
import { readLightscaperNativeSmartCollectionQueryPageCurrentV1 as savedOrdinary, readLightscaperNativeSmartCollectionStackQueryPageCurrentV1 as savedCollapsed } from '../desktop/lightscaper-native-smart-collection-query-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { photoQueryMatcherV1 } from '../src/lightscaper/catalog/photo-query-matcher-v1.ts';
import { photoQueryMatcherV2 } from '../src/lightscaper/catalog/photo-query-matcher-v2.ts';
import { photoQueryRowKeyV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { photoQueryRowKeyV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import type { PhotoCatalogContinuationV1 } from '../src/lightscaper/catalog/repository-types.ts';
import type { PhotoLibraryCullingNavigationContextV1 as Context } from '../src/common/editor/photo-library-culling-navigation-port-v1.ts';
import type { PhotoLibraryPageV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { nativeCullingFixtureCurrentV1 as fixture, seedNativeCullingCurrentV1 as seed, CATALOG, photoId, queryV1, queryV2 } from './helpers/lightscaper-native-culling-fixture-current.ts';
import { expectedNativeLegacyStackQueryCurrentV1 as legacyExpected } from './helpers/lightscaper-native-legacy-stack-query-fixture-current.ts';
import { expectedNativeStackQueryCurrentV1 as metadataExpected } from './helpers/lightscaper-native-stack-query-fixture-current.ts';

function following(db: DatabaseSync, context: Context, cursor: string) {
	const continuation: unknown = JSON.parse(cursor);
	if (context.kind === 'plain') return plainPage(db, CATALOG, { continuation: continuation as PhotoCatalogContinuationV1 });
	if (context.kind === 'saved') return (context.collapsed ? savedCollapsed : savedOrdinary)(db, CATALOG, context.collectionId, { continuation });
	if ('schemaVersion' in context.query) return (context.collapsed ? collapsedV2 : ordinaryV2)(db, CATALOG, { query: context.query, continuation });
	return (context.collapsed ? collapsedV1 : ordinaryV1)(db, CATALOG, { query: context.query, continuation });
}
function collect(db: DatabaseSync, context: Context, first: PhotoLibraryPageV1) {
	const ids = first.rows.map(row => row.id); let cursor = first.cursor, pages = 0, empty = 0;
	while (cursor !== null) {
		assert.ok(pages++ < 100); const result = following(db, context, cursor);
		if (!result.items.length) empty++; ids.push(...result.items.map(row => row.photoId));
		cursor = result.continuation === null ? null : JSON.stringify(result.continuation); assert.equal(db.isTransaction, false);
	}
	return { ids, empty };
}
function ordinaryExpected(f: ReturnType<typeof seed>, context: Extract<Context, { kind: 'query' }>): string[] {
	const query = context.query, metadata = 'schemaVersion' in query;
	const matches = metadata ? photoQueryMatcherV2(f.root, query) : photoQueryMatcherV1(f.root, query);
	const rows = metadata ? f.rowsV2 : f.rowsV1;
	const keys = rows.filter(row => (matches as (value: typeof row) => boolean)(row)).map(row => ({ id: row.photoId,
		key: metadata ? photoQueryRowKeyV2(row as typeof f.rowsV2[number], query.sort.field) : photoQueryRowKeyV1(row as typeof f.rowsV1[number], query.sort.field) }));
	keys.sort((a, b) => {
		if (query.sort.field === 'capture-time' && a.key[1] !== b.key[1]) return Number(a.key[1]) - Number(b.key[1]);
		for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return (a.key[i]! < b.key[i]! ? -1 : 1) * (query.sort.direction === 'ascending' ? 1 : -1);
		return 0;
	}); return keys.map(row => row.id);
}
function pageShape(page: PhotoLibraryPageV1) {
	assert.deepEqual(Object.keys(page).sort(), ['catalogName', 'totalCount', 'rows', 'cursor'].sort()); assert.ok(Object.isFrozen(page.rows));
	for (const row of page.rows) assert.deepEqual(Object.keys(row).sort(), ['id', 'fileName', 'width', 'height', 'rating', 'flag', 'colorLabel'].sort());
}

for (const field of ['photo-id', 'file-name', 'capture-time', 'rating'] as const) for (const direction of ['ascending', 'descending'] as const) {
	test(`Lightscaper native all6 queried culling paths preserve ${field} ${direction} inclusive order and genuine next cursors`, async () => {
		await fixture(async db => {
			const legacy = queryV1({ filter: { kind: 'flag', value: 'pick' }, sort: { field, direction } }), metadata = queryV2({ filter: legacy.filter, sort: legacy.sort });
			const f = seed(db, 130, { savedQuery: metadata, groups: [{ indices: [0, 1, 2, 3], cover: 1 }, { indices: [64, 65, 66], cover: 64 }], patch: (photo, index) => normalizePhotoDocumentCurrentV1({ ...photo,
				metadata: { ...photo.metadata, fileName: ['\ud800', '\udc00', '\ue000', '𐀀', 'Same', 'same', 'İ'.repeat(256)][index % 7] } }) });
			for (const collapsed of [false, true]) for (const protocol of ['legacy', 'metadata', 'saved'] as const) {
				const query = protocol === 'legacy' ? legacy : metadata, context: Context = protocol === 'saved' ? { kind: 'saved', collectionId: 'saved', collapsed } : { kind: 'query', query, collapsed };
				const expected = collapsed ? protocol === 'legacy' ? legacyExpected(f, legacy) : metadataExpected(f, metadata)
					: ordinaryExpected(f, { kind: 'query', query, collapsed });
				const index = Math.floor(expected.length / 3), selected = expected[index]!; assert.ok(selected);
				const page = await destination(db, CATALOG, context, { photoId: selected }); assert.ok(page); pageShape(page);
				assert.equal(page.rows[0]?.id, selected); assert.ok(page.rows.length <= 64); assert.equal(page.totalCount, 130);
				assert.deepEqual(page.rows.map(row => row.id), expected.slice(index, index + page.rows.length));
				assert.deepEqual(collect(db, context, page).ids, expected.slice(index)); assert.equal(db.isTransaction, false);
				if (page.cursor && protocol === 'legacy' && !collapsed) assert.ok(Buffer.byteLength(page.cursor) <= 2048);
			}
		});
	});
}

test('Lightscaper native plain culling selected plus63 successors is independent of missing query builds and grouping state', async () => {
	await fixture(async db => {
		seed(db, 130); db.exec('DELETE FROM native_photo_query_builds_v1; DELETE FROM native_photo_query_builds_v2; DELETE FROM native_photo_stack_states');
		const context = { kind: 'plain' } as const, page = await destination(db, CATALOG, context, { photoId: photoId(64) }); assert.ok(page); pageShape(page);
		assert.deepEqual(page.rows.map(row => row.id), Array.from({ length: 64 }, (_, i) => photoId(i + 64)));
		assert.deepEqual(collect(db, context, page).ids, Array.from({ length: 66 }, (_, i) => photoId(i + 64)));
		const exact = await destination(db, CATALOG, context, { photoId: photoId(66) }); assert.ok(exact?.cursor); assert.equal(following(db, context, exact.cursor).items.length, 0);
		assert.equal(await destination(db, CATALOG, context, { photoId: 'missing' }), null);
	});
});

test('Lightscaper native ordinary culling preserves sparse64-candidate scans and legal empty subsequent pages', async () => {
	await fixture(async db => {
		const query = queryV2({ predicate: { kind: 'number', column: 'iso', minimum: 800, maximum: 800 } });
		seed(db, 130, { savedQuery: query, patch: (photo, i) => normalizePhotoDocumentCurrentV1({ ...photo, metadata: { ...photo.metadata, iso: i === 0 || i === 129 ? 800 : 200 } }) });
		for (const context of [{ kind: 'query', query, collapsed: false }, { kind: 'saved', collectionId: 'saved', collapsed: false }] as const) {
			const page = await destination(db, CATALOG, context, { photoId: photoId(0) }); assert.ok(page?.cursor); assert.deepEqual(page.rows.map(row => row.id), [photoId(0)]);
			const result = collect(db, context, page); assert.deepEqual(result.ids, [photoId(0), photoId(129)]); assert.ok(result.empty > 0);
			assert.equal(await destination(db, CATALOG, context, { photoId: photoId(1) }), null);
		}
	});
});

test('Lightscaper native ordinary Query2 culling retires the genuine inclusive iterator before COMMIT', async () => {
	await fixture(async db => {
		seed(db, 130); const prepare = db.prepare; let returned = 0;
		db.prepare = function (...args: Parameters<typeof prepare>) {
			const statement = prepare.apply(db, args);
			if (/FROM native_photo_query_rows_v2/iu.test(args[0]) && /LIMIT \?/u.test(args[0])) {
				const iterate = statement.iterate;
				statement.iterate = (...values: unknown[]) => {
					const iterator = Reflect.apply(iterate, statement, values) as ReturnType<typeof iterate>, close = iterator.return;
					if (close) iterator.return = function () { returned++; return Reflect.apply(close, iterator, []) as ReturnType<typeof close>; }; return iterator;
				};
			} return statement;
		};
		try { const page = await destination(db, CATALOG, { kind: 'query', query: queryV2(), collapsed: false }, { photoId: photoId(0) }); assert.equal(page?.rows.length, 64); assert.equal(returned, 1); }
		finally { db.prepare = prepare; }
	});
});

test('Lightscaper native ordinary Query2 culling preserves primary parse failure plus actual cursor cleanup failure', async () => {
	await fixture(async db => {
		seed(db, 130); db.prepare('UPDATE native_photo_query_rows_v2 SET row_json=? WHERE photo_id=?').run('{}', photoId(1));
		const prepare = db.prepare, cleanup = new Error('Observed native return cleanup failure'); let returned = 0;
		db.prepare = function (...args: Parameters<typeof prepare>) {
			const statement = prepare.apply(db, args);
			if (/FROM native_photo_query_rows_v2/iu.test(args[0]) && /LIMIT \?/u.test(args[0])) {
				const iterate = statement.iterate; statement.iterate = (...values: unknown[]) => {
					const iterator = Reflect.apply(iterate, statement, values) as ReturnType<typeof iterate>, close = iterator.return;
					if (close) iterator.return = function () { returned++; Reflect.apply(close, iterator, []); throw cleanup; }; return iterator;
				};
			} return statement;
		};
		try {
			await assert.rejects(destination(db, CATALOG, { kind: 'query', query: queryV2(), collapsed: false }, { photoId: photoId(0) }),
				(error: unknown) => error instanceof AggregateError && error.errors.length === 2 && error.errors.includes(cleanup));
			assert.equal(returned, 1); assert.equal(db.isTransaction, false);
		} finally { db.prepare = prepare; }
	});
});
