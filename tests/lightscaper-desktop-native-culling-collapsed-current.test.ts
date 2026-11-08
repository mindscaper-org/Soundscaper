/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { readLightscaperNativeCullingDestinationPageCurrentV1 as destination } from '../desktop/lightscaper-native-culling-current-v1.ts';
import { readLightscaperNativeLegacyStackQueryPageCurrentV1 as nextV1 } from '../desktop/lightscaper-native-legacy-stack-query-current-v1.ts';
import { readLightscaperNativeStackQueryPageCurrentV1 as nextV2 } from '../desktop/lightscaper-native-stack-query-current-v1.ts';
import { readLightscaperNativeSmartCollectionStackQueryPageCurrentV1 as nextSaved } from '../desktop/lightscaper-native-smart-collection-query-current-v1.ts';
import type { PhotoLibraryCullingNavigationContextV1 as Context } from '../src/common/editor/photo-library-culling-navigation-port-v1.ts';
import { nativeCullingFixtureCurrentV1 as fixture, seedNativeCullingCurrentV1 as seed, CATALOG, photoId, queryV1, queryV2 } from './helpers/lightscaper-native-culling-fixture-current.ts';

/** Observe only actual native results, with no JSON parsing or row synthesis.
 * One selected projection point per phase is outside the shared64 ledger. */
function observe(db: DatabaseSync) {
	const prepare = db.prepare, exec = db.exec, phases: { work: number; selected: number; audits: number }[] = [];
	let work = 0, selected = 0, audits = 0;
	db.prepare = function (...args: Parameters<typeof prepare>) {
		const statement = prepare.apply(db, args), sql = args[0];
		const row = /FROM native_photo_query_rows_v[12]\b/iu.test(sql), audit = /FROM native_photo_stacks\b/iu.test(sql) && !/\bdocument\b/iu.test(sql);
		const full = /FROM native_photos\b/iu.test(sql) && /\bdocument\b/iu.test(sql);
		if (row || audit || full) {
			const get = statement.get;
			statement.get = (...values: unknown[]) => {
				const value = Reflect.apply(get, statement, values) as ReturnType<typeof get>;
				if (value !== undefined) { if (row) work++; if (audit) { work++; audits++; } if (full) selected++; } return value;
			};
		} return statement;
	};
	db.exec = function (sql) { const result = exec.call(db, sql); if (sql === 'COMMIT') { phases.push({ work, selected, audits }); work = 0; selected = 0; audits = 0; } return result; };
	return { phases, restore() { db.prepare = prepare; db.exec = exec; } };
}
function contexts() {
	return [{ kind: 'query', query: queryV1(), collapsed: true }, { kind: 'query', query: queryV2(), collapsed: true },
		{ kind: 'saved', collectionId: 'saved', collapsed: true }] as const;
}
function resume(db: DatabaseSync, context: Context, cursor: string) {
	const continuation: unknown = JSON.parse(cursor);
	if (context.kind === 'saved') return nextSaved(db, CATALOG, 'saved', { continuation });
	assert.equal(context.kind, 'query'); if (context.kind !== 'query') throw Error('Unexpected plain mode');
	return 'schemaVersion' in context.query ? nextV2(db, CATALOG, { query: context.query, continuation }) : nextV1(db, CATALOG, { query: context.query, continuation });
}
function assertLedger(phases: readonly { work: number; selected: number }[]) {
	assert.ok(phases.length > 1, 'The actual traversal must require multiple committed phases.');
	for (const phase of phases) { assert.equal(phase.selected, 1, 'Each fresh phase must repeat its whole selected Photo proof.'); assert.ok(phase.work <= 65, 'Selected point plus at most64 shared query/audit units.'); }
}

for (const count of [64, 65]) test(`Lightscaper native collapsed culling preserves inclusive selected start through exact${count} stack audit`, async () => {
	for (const context of contexts()) await fixture(async db => {
		seed(db, count * 2, { groups: Array.from({ length: count }, (_, i) => ({ indices: [i * 2, i * 2 + 1], cover: i * 2 })) });
		const watched = observe(db);
		let page: Awaited<ReturnType<typeof destination>>;
		try {
			page = await destination(db, CATALOG, context, { photoId: photoId(0) }); assert.ok(page); assert.equal(page.rows[0]?.id, photoId(0)); assertLedger(watched.phases);
			assert.equal(watched.phases.reduce((sum, phase) => sum + phase.audits, 0), count);
		} finally { watched.restore(); }
		assert.ok(page); const ids = page.rows.map(row => row.id); let cursor = page.cursor, steps = 0;
		while (cursor) { assert.ok(steps++ < 20); const result = resume(db, context, cursor); ids.push(...result.items.map(row => row.photoId)); cursor = result.continuation === null ? null : JSON.stringify(result.continuation); }
		assert.deepEqual(ids, Array.from({ length: count }, (_, i) => photoId(i * 2))); assert.equal(db.isTransaction, false);
	});
});

test('Lightscaper native all3 collapsed culling paths authenticate1024-member selected closure within each64-unit phase', async () => {
	for (const context of contexts()) await fixture(async db => {
		seed(db, 1024, { groups: [{ indices: Array.from({ length: 1024 }, (_, i) => i), cover: 1023 }] }); const watched = observe(db);
		try {
			const page = await destination(db, CATALOG, context, { photoId: photoId(1023) }); assert.ok(page); assert.deepEqual(page.rows.map(row => row.id), [photoId(1023)]);
			assertLedger(watched.phases); assert.ok(watched.phases.length >= 17); assert.equal(db.isTransaction, false);
		} finally { watched.restore(); }
	});
});

for (const direction of ['ascending', 'descending'] as const) test(`Lightscaper native collapsed culling ${direction} filtered cover uses first eligible member and never redirects suppressed selection`, async () => {
	await fixture(async db => {
		const sort = { field: 'photo-id', direction } as const, legacy = queryV1({ filter: { kind: 'flag', value: 'pick' }, sort }), metadata = queryV2({ filter: legacy.filter, sort });
		seed(db, 130, { savedQuery: metadata, groups: [{ indices: Array.from({ length: 130 }, (_, i) => i), cover: 129 }] });
		const winner = direction === 'ascending' ? 0 : 128;
		for (const context of [{ kind: 'query', query: legacy, collapsed: true }, { kind: 'query', query: metadata, collapsed: true }, { kind: 'saved', collectionId: 'saved', collapsed: true }] as const) {
			const page = await destination(db, CATALOG, context, { photoId: photoId(winner) }); assert.deepEqual(page?.rows.map(row => row.id), [photoId(winner)]);
			assert.equal(await destination(db, CATALOG, context, { photoId: photoId(2) }), null); assert.equal(await destination(db, CATALOG, context, { photoId: photoId(129) }), null);
		}
	});
});

test('Lightscaper native collapsed culling source point and independent reverse membership cannot disappear during selected closure', async () => {
	for (const table of ['native_photo_stack_memberships', 'native_photo_query_rows_v2']) await fixture(async db => {
		seed(db, 130, { groups: [{ indices: Array.from({ length: 130 }, (_, i) => i), cover: 129 }] });
		db.prepare(`DELETE FROM ${table} WHERE photo_key=?`).run(`${CATALOG}|${photoId(64)}`);
		await assert.rejects(destination(db, CATALOG, { kind: 'query', query: queryV2(), collapsed: true }, { photoId: photoId(129) })); assert.equal(db.isTransaction, false);
	});
});
