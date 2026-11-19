/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { LightscaperNativeCatalogStoreCurrentV1 as Store } from '../desktop/lightscaper-native-catalog-store-current-v1.ts';
import type { PhotoLibraryCullingNavigationContextV1 } from '../src/common/editor/photo-library-culling-navigation-port-v1.ts';
import { normalizePhotoCatalogQueryV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import { projectPhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { nativePhotoCurrentV1 } from './helpers/lightscaper-native-catalog-fixture-current.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { CATALOG, nativeCullingOwnerFixtureCurrentV1 as fixture, nativeCullingOwnerContextsCurrentV1 as contexts,
	nativeCullingOwnerDestinationCurrentV1 as destination, nativeCullingOwnerIndexedPageCurrentV1 as indexedPage,
	nativeCullingOwnerSqlSnapshotCurrentV1 as snapshot } from './helpers/lightscaper-native-culling-owner-fixture-current.ts';

const unchanged = ['native_photo_query_builds_v1', 'native_photo_query_builds_v2',
	'native_photo_stacks', 'native_photo_stack_states', 'native_photo_stack_forward_members', 'native_photo_stack_memberships',
	'native_photo_smart_collections', 'native_photo_smart_collection_summaries', 'native_photo_smart_collection_states'];
function storedJson(database: DatabaseSync, table: string, column: string, key: string): unknown {
	const row = database.prepare(`SELECT ${column} AS value FROM ${table} WHERE photo_key=?`).get(key);
	assert.ok(row && typeof row.value === 'string'); return JSON.parse(row.value) as unknown;
}

function membershipRows(database: DatabaseSync) {
	return database.prepare('SELECT key,scope,photo_key,catalog_id FROM native_photo_memberships ORDER BY key COLLATE BINARY').all().map(row => {
		const { key, scope, photo_key, catalog_id } = row;
		assert.ok(typeof key === 'string' && typeof scope === 'string' && typeof photo_key === 'string' && typeof catalog_id === 'string');
		return { key, scope, photo_key, catalog_id };
	});
}

for (const [name, context] of contexts) test(`Lightscaper native culling ${name} refreshes an actual attribute commit with a fresh inclusive resumable cursor`, async () => {
	await fixture(async ({ store, database, photos, root, indexRevision }) => {
		const chosen = photos[0]!, oldPage = await indexedPage(store, context); assert.ok(oldPage.continuation);
		const membershipsBefore = membershipRows(database), preserved = snapshot(database, unchanged), beforeRoot = database.prepare('SELECT * FROM native_photo_catalogs WHERE id=?').get(CATALOG); assert.ok(beforeRoot);
		const saved = await store.savePhoto({ ...chosen, rating: 2, flag: 'pick', colorLabel: 'purple' }, chosen.revision);
		assert.equal(saved.revision, chosen.revision + 1); assert.equal(saved.schemaVersion, chosen.schemaVersion);
		assert.deepEqual(saved.original, chosen.original); assert.deepEqual(saved.extractedMetadata, chosen.extractedMetadata); assert.deepEqual(saved.versions, chosen.versions);
		assert.deepEqual(await store.loadCatalog(CATALOG), root); assert.deepEqual(snapshot(database, unchanged), preserved);
		const afterRoot = database.prepare('SELECT * FROM native_photo_catalogs WHERE id=?').get(CATALOG); assert.ok(afterRoot);
		assert.deepEqual({ ...afterRoot }, { ...beforeRoot, index_revision: indexRevision + 1 });
		const key = photoStorageKey(CATALOG, chosen.id);
		const attributePrefixes = ['rating', 'flag', 'label'].map(kind => `${CATALOG}|${kind}|`);
		const isReplaced = (row: ReturnType<typeof membershipRows>[number]) => row.photo_key === key && attributePrefixes.some(prefix => row.scope.startsWith(prefix));
		assert.equal(membershipsBefore.filter(isReplaced).length, 3, 'The selected Photo owns one actual rating, flag and label scope before editing.');
		const expectedMemberships = [...membershipsBefore.filter(row => !isReplaced(row)),
			...['rating|2', 'flag|pick', 'label|purple'].map(attribute => {
				const scope = `${CATALOG}|${attribute}`; return { key: `${scope}|${chosen.id}`, scope, photo_key: key, catalog_id: CATALOG };
			})].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
		assert.deepEqual(membershipRows(database), expectedMemberships, 'Only the selected rating/flag/label memberships change; every other persisted membership remains exact.');
		assert.deepEqual(storedJson(database, 'native_photos', 'summary', key), photoSummary(saved));
		assert.deepEqual(storedJson(database, 'native_photo_query_rows_v1', 'row_json', key), projectPhotoQueryRowV1(saved));
		assert.deepEqual(storedJson(database, 'native_photo_query_rows_v2', 'row_json', key), projectPhotoQueryRowV2(saved));
		await assert.rejects(indexedPage(store, context, oldPage.continuation), context.kind === 'saved'
			? { name: 'PhotoSmartCollectionRevisionConflictError' } : { code: 'CATALOG_REVISION_CONFLICT' });
		const page = await destination(store, context, { photoId: chosen.id }); assert.ok(page);
		assert.equal(page.rows[0]?.id, chosen.id); assert.deepEqual(page.rows[0], { id: saved.id, fileName: saved.metadata.fileName,
			width: saved.original.width, height: saved.original.height, rating: 2, flag: 'pick', colorLabel: 'purple' });
		assert.equal(page.totalCount, photos.length); assert.ok(page.cursor, 'This actual130-Photo destination must retain further work.');
		const cursor: unknown = JSON.parse(page.cursor), resumed = await indexedPage(store, context, cursor);
		assert.ok(resumed.items.length > 0); const delivered = new Set(page.rows.map(row => row.id));
		assert.ok(resumed.items.every(row => !delivered.has(row.photoId)), 'The matching native reader must resume exclusively after the fresh destination window.');
		assert.equal((await store.readSnapshot(CATALOG))?.indexRevision, indexRevision + 1);
		assert.deepEqual(await store.readOriginal(CATALOG, chosen.id, 0, 3), Uint8Array.of(1, 2, 3));
	});
});

test('Lightscaper native culling captures mutable criteria and point before a held genuine Original upload queue wait', async () => {
	await fixture(async ({ store, photos }) => {
		const entered = deferred<void>(), release = deferred<void>(); let upload: Promise<unknown> | undefined, reading: ReturnType<typeof destination> | undefined;
		try {
			const extra = nativePhotoCurrentV1(999);
			upload = store.storeOriginal(extra.original, (async function* () { entered.resolve(); await release.promise; yield Uint8Array.of(1, 2, 3); })());
			await entered.promise;
			const context = { kind: 'query' as const, query: { ...normalizePhotoCatalogQueryV1(), filter: null as { kind: 'rating'; value: number } | null }, collapsed: false };
			const request = { photoId: photos[0]!.id }; reading = destination(store, context, request);
			context.query.filter = { kind: 'rating', value: 5 }; request.photoId = 'changed-after-capture';
			assert.equal(await remainsPending(reading), true); release.resolve(); await upload;
			const page = await reading; assert.ok(page); assert.equal(page.rows[0]?.id, photos[0]!.id); assert.equal(page.rows.length, photos.length);
		} finally { release.resolve(); await Promise.allSettled([upload, reading]); }
	}, { count: 4 });
});

test('Lightscaper native culling keeps an opaque queued caller abort and joins held Original work before cached close', async () => {
	await fixture(async ({ store, directory, photos, indexRevision }) => {
		const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(); let traps = 0;
		const reason = new Proxy({}, { get() { traps++; throw Error('Opaque abort get'); }, getPrototypeOf() { traps++; throw Error('Opaque abort prototype'); } });
		let upload: Promise<unknown> | undefined, reading: ReturnType<typeof destination> | undefined, observed: Promise<void> | undefined, closing: Promise<void> | undefined;
		let caught: unknown;
		try {
			const extra = nativePhotoCurrentV1(998);
			upload = store.storeOriginal(extra.original, (async function* () { entered.resolve(); await release.promise; yield Uint8Array.of(1, 2, 3); })()); await entered.promise;
			reading = destination(store, { kind: 'plain' }, { photoId: photos[0]!.id, signal: stop.signal });
			// Manual rejection observer: Node assert.rejects may reflect arbitrary thrown then/prototype properties.
			observed = reading.then(() => assert.fail('Cancelled queued native culling read acknowledged.'), (error: unknown) => { caught = error; });
			stop.abort(reason); closing = store.close(); assert.equal(store.close(), closing);
			assert.equal(await remainsPending(reading), true); assert.equal(await remainsPending(closing), true);
			await assert.rejects(store.loadPhoto(CATALOG, photos[0]!.id), { code: 'CATALOG_CLOSED' });
			release.resolve(); await upload; await observed; assert.ok(caught === reason); assert.equal(traps, 0); await closing;
			const reopened = await Store.open({ appDataPath: directory });
			try { assert.deepEqual(await reopened.loadPhoto(CATALOG, photos[0]!.id), photos[0]); assert.equal((await reopened.readSnapshot(CATALOG))?.indexRevision, indexRevision); }
			finally { await reopened.close(); }
		} finally { release.resolve(); await Promise.allSettled([upload, reading, observed, closing]); }
	}, { count: 4 });
});

test('Lightscaper native culling shutdown joins an actual65-stack count phase and event-loop yield before SQLite retirement', async () => {
	await fixture(async ({ store, directory, photos, indexRevision }) => {
		const original = DatabaseSync.prototype.exec, entered = deferred<void>(), probe = deferred<void>();
		const readers = new WeakSet<DatabaseSync>(); let commits = 0, scheduled = false, readSettled = false, closeSettled = false;
		let reading: ReturnType<typeof destination> | undefined, refused: Promise<void> | undefined, closing: Promise<void> | undefined;
		DatabaseSync.prototype.exec = function (sql: string): void {
			Reflect.apply(original, this, [sql]); if (sql === 'BEGIN') readers.add(this);
			if (sql === 'COMMIT' && readers.has(this)) {
				readers.delete(this);
				commits++; assert.equal(this.isTransaction, false);
				if (!scheduled) { scheduled = true; setImmediate(() => {
					closing = store.close(); void closing.then(() => { closeSettled = true; }, () => { closeSettled = true; });
					queueMicrotask(() => { try { assert.equal(readSettled, false); assert.equal(closeSettled, false); probe.resolve(); } catch (error) { probe.reject(error); } });
					entered.resolve();
				}); }
			}
		};
		try {
			const context: PhotoLibraryCullingNavigationContextV1 = { kind: 'query', query: normalizePhotoCatalogQueryV1(), collapsed: true };
			reading = destination(store, context, { photoId: photos[0]!.id });
			void reading.then(() => { readSettled = true; }, () => { readSettled = true; });
			refused = assert.rejects(reading, { code: 'CATALOG_CLOSED' });
			await Promise.race([entered.promise, reading.then(() => { throw Error('Large native grouping skipped its required yielding phase.'); }, (error: unknown) => { throw error; })]);
			await probe.promise; await refused; assert.ok(closing); await closing; assert.equal(commits, 1);
		} finally { DatabaseSync.prototype.exec = original; await Promise.allSettled([reading, refused, closing]); }
		const reopened = await Store.open({ appDataPath: directory });
		try { assert.equal((await reopened.readStackState(CATALOG)).stackCount, 65); assert.equal((await reopened.readSnapshot(CATALOG))?.indexRevision, indexRevision); }
		finally { await reopened.close(); }
	}, { groups: 'sixty-five' });
});

test('Lightscaper native culling read refusal after actual edit COMMIT cannot erase its durable ACK across reentrant close', async () => {
	await fixture(async ({ store, directory, photos, root, indexRevision }) => {
		const original = DatabaseSync.prototype.exec, writers = new WeakSet<DatabaseSync>(); let closing: Promise<void> | undefined, committed = false;
		DatabaseSync.prototype.exec = function (sql: string): void {
			const completing = sql === 'COMMIT' && writers.has(this); Reflect.apply(original, this, [sql]);
			if (sql === 'BEGIN IMMEDIATE') writers.add(this);
			if (completing) { committed = true; writers.delete(this); closing = store.close(); }
		};
		try {
			const selected = photos[0]!, saved = await store.savePhoto({ ...selected, rating: 5, flag: 'pick', colorLabel: 'green' }, selected.revision);
			assert.equal(committed, true); assert.ok(closing); assert.equal(saved.revision, 1); assert.equal(saved.rating, 5); await closing;
			await assert.rejects(async () => destination(store, { kind: 'plain' }, { photoId: selected.id }), { code: 'CATALOG_CLOSED' });
		} finally { DatabaseSync.prototype.exec = original; await closing; }
		const reopened = await Store.open({ appDataPath: directory });
		try {
			const stored = await reopened.loadPhoto(CATALOG, photos[0]!.id); assert.ok(stored); assert.equal(stored.rating, 5); assert.equal(stored.revision, 1);
			assert.deepEqual(stored.original, photos[0]!.original); assert.deepEqual(stored.versions, photos[0]!.versions);
			assert.deepEqual(await reopened.loadCatalog(CATALOG), root); assert.equal((await reopened.readSnapshot(CATALOG))?.indexRevision, indexRevision + 1);
			assert.deepEqual(await reopened.readOriginal(CATALOG, stored.id, 0, 3), Uint8Array.of(1, 2, 3));
		} finally { await reopened.close(); }
	}, { count: 4 });
});
