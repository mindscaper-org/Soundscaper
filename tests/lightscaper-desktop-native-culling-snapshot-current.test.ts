/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { readLightscaperNativeCullingDestinationPageCurrentV1 as read } from '../desktop/lightscaper-native-culling-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { projectPhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import type { PhotoLibraryCullingNavigationContextV1 as Context } from '../src/common/editor/photo-library-culling-navigation-port-v1.ts';
import { nativeCullingFixtureCurrentV1 as fixture, seedNativeCullingCurrentV1 as seed,
	CATALOG, key, photoId, queryV1, queryV2 } from './helpers/lightscaper-native-culling-fixture-current.ts';
import { putLegacyQueryRowCurrentV1, replaceLegacyQuerySourceCurrentV1 } from './helpers/lightscaper-native-legacy-query-fixture-current.ts';
import { writeNativeStackQueryRowCurrentV1 } from './helpers/lightscaper-native-stack-query-fixture-current.ts';

const contexts: readonly (readonly [string, Context])[] = [
	['plain', { kind: 'plain' }],
	...[false, true].flatMap(collapsed => [
		[`Query1 ${String(collapsed)}`, { kind: 'query', query: queryV1(), collapsed }],
		[`Query2 ${String(collapsed)}`, { kind: 'query', query: queryV2(), collapsed }],
		[`saved ${String(collapsed)}`, { kind: 'saved', collectionId: 'saved', collapsed }]
	] as const)
];

for (const [name, context] of contexts) test(`Lightscaper native culling ${name} selected proof and page share a genuine competing WAL snapshot`, async () => {
	await fixture(async (database, path) => {
		const f = seed(database, 4), writer = new DatabaseSync(path), originalPrepare = database.prepare;
		const previous = f.photos[0]!, changed = normalizePhotoDocumentCurrentV1({ ...previous, revision: previous.revision + 1, rating: (previous.rating + 1) % 6 });
		const root = { ...f.root, revision: f.root.revision + 1, name: 'Committed competing root' }; let committed = false;
		database.prepare = function (...args: Parameters<typeof originalPrepare>) {
			const statement = originalPrepare.apply(database, args), [sql] = args;
			if (!/\bFROM\s+native_photos\b/iu.test(sql) || !/\bdocument\b/iu.test(sql)) return statement;
			const get = statement.get;
			statement.get = function (...values: unknown[]) {
				const row = Reflect.apply(get, statement, values) as ReturnType<typeof get>;
				if (!committed && row !== undefined) {
					committed = true; writer.exec('BEGIN IMMEDIATE');
					try {
						replaceLegacyQuerySourceCurrentV1(writer, changed);
						putLegacyQueryRowCurrentV1(writer, projectPhotoQueryRowV1(changed));
						writeNativeStackQueryRowCurrentV1(writer, projectPhotoQueryRowV2(changed));
						writer.prepare('UPDATE native_photo_catalogs SET document=?,root_revision=?,index_revision=index_revision+1 WHERE id=?')
							.run(JSON.stringify(root), root.revision, CATALOG); writer.exec('COMMIT');
					} catch (error) { if (writer.isTransaction) writer.exec('ROLLBACK'); throw error; }
				}
				return row;
			}; return statement;
		};
		try {
			const oldPage = await read(database, CATALOG, context, { photoId: previous.id });
			assert.equal(committed, true); assert.equal(oldPage?.catalogName, f.root.name); assert.equal(oldPage?.rows[0]?.rating, previous.rating);
			assert.equal(database.isTransaction, false);
			const fresh = await read(database, CATALOG, context, { photoId: previous.id });
			assert.equal(fresh?.catalogName, root.name); assert.equal(fresh?.rows[0]?.rating, changed.rating);
		} finally { database.prepare = originalPrepare; writer.close(); }
	});
});

type Seed = ReturnType<typeof seed>;
type Fence = Readonly<{ name: string; context: Context; expectedCode?: string; change: (writer: DatabaseSync, f: Seed) => void }>;
const collapsed: Context = { kind: 'query', query: queryV2(), collapsed: true };
const saved: Context = { kind: 'saved', collectionId: 'saved', collapsed: true };
const fences: readonly Fence[] = [
	{ name: 'root before missing readiness', context: collapsed, change(writer, f) {
		const root = { ...f.root, revision: f.root.revision + 1 };
		writer.prepare('UPDATE native_photo_catalogs SET document=?,root_revision=? WHERE id=?').run(JSON.stringify(root), root.revision, CATALOG);
		writer.prepare('UPDATE native_photo_query_builds_v2 SET ready=0 WHERE catalog_id=?').run(CATALOG);
	} },
	{ name: 'index', context: collapsed, change(writer) { writer.prepare('UPDATE native_photo_catalogs SET index_revision=index_revision+1 WHERE id=?').run(CATALOG); } },
	{ name: 'grouping-only change plus missing readiness', context: collapsed, expectedCode: 'PHOTO_QUERY_INDEX_NOT_READY', change(writer) {
		writer.prepare('UPDATE native_photo_stack_states SET revision=revision+1 WHERE catalog_id=?').run(CATALOG);
		writer.prepare('UPDATE native_photo_query_builds_v2 SET ready=0 WHERE catalog_id=?').run(CATALOG);
	} },
	{ name: 'saved state', context: saved, change(writer) { writer.prepare('UPDATE native_photo_smart_collection_states SET revision=revision+1 WHERE catalog_id=?').run(CATALOG); } },
	{ name: 'saved same-revision complete recipe digest before membership', context: saved, change(writer, f) {
		writer.prepare('UPDATE native_photo_smart_collections SET document=? WHERE catalog_id=?')
			.run(JSON.stringify({ ...f.savedDefinition, query: { ...f.savedDefinition.query, text: 'no surviving selected result' } }), CATALOG);
	} }
];

async function afterFirstCommittedPhase(database: DatabaseSync, action: () => void,
	run: () => Promise<void>): Promise<void> {
	const original = database.exec; let fired = false, turn: Promise<void> | undefined;
	database.exec = function (sql: string): void {
		original.call(database, sql);
		if (sql === 'COMMIT' && !fired) {
			fired = true;
			turn = new Promise<void>((resolve, reject) => { setImmediate(() => { try { action(); resolve(); } catch (error) { reject(error); } }); });
			void turn.catch(() => undefined);
		}
	};
	try { await run(); assert.equal(fired, true); await turn; }
	finally { database.exec = original; await turn; }
}

for (const fence of fences) test(`Lightscaper native culling private phases fence ${fence.name} after a real joined native turn`, async () => {
	await fixture(async (database, path) => {
		const f = seed(database, 132, { groups: Array.from({ length: 65 }, (_, index) => ({ indices: [index * 2, index * 2 + 1], cover: index * 2 })) });
		const writer = new DatabaseSync(path);
		try {
			await afterFirstCommittedPhase(database, () => {
				assert.equal(database.isTransaction, false); writer.exec('BEGIN IMMEDIATE');
				try { fence.change(writer, f); writer.exec('COMMIT'); }
				catch (error) { if (writer.isTransaction) writer.exec('ROLLBACK'); throw error; }
			}, async () => { await assert.rejects(read(database, CATALOG, fence.context, { photoId: photoId(130) }), { code: fence.expectedCode ?? 'CATALOG_REVISION_CONFLICT' }); });
			assert.equal(database.isTransaction, false);
		} finally { writer.close(); }
	});
});

test('Lightscaper native culling repeats whole selected Photo admission after private audit phases without epoch drift', async () => {
	await fixture(async (database, path) => {
		seed(database, 132, { groups: Array.from({ length: 65 }, (_, index) => ({ indices: [index * 2, index * 2 + 1], cover: index * 2 })) });
		const writer = new DatabaseSync(path);
		try {
			await afterFirstCommittedPhase(database, () => {
				writer.prepare('UPDATE native_photos SET document=? WHERE photo_key=?').run('{invalid selected Current after audit', key(130));
			}, async () => { await assert.rejects(read(database, CATALOG, collapsed, { photoId: photoId(130) })); });
			assert.equal(database.isTransaction, false);
		} finally { writer.close(); }
	});
});

test('Lightscaper native culling read-only COMMIT cancellation refuses late scalar publication with its opaque reason', async () => {
	await fixture(async database => {
		seed(database, 2); const cancel = new AbortController(), reason = Symbol('after actual read commit'), original = database.exec; let committed = false;
		database.exec = function (sql: string): void { original.call(database, sql); if (sql === 'COMMIT') { committed = true; cancel.abort(reason); } };
		try {
			await assert.rejects(read(database, CATALOG, { kind: 'plain' }, { photoId: photoId(0), signal: cancel.signal }), error => error === reason);
			assert.equal(committed, true); assert.equal(database.isTransaction, false);
		} finally { database.exec = original; }
	});
});
