/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createPhotoLibraryCullingWorkflowV1 } from '../src/common/editor/controller/shared/photo-library-culling-workflow-v1.ts';
import { readVisiblePage } from '../src/common/editor/controller/shared/photo-library-query-navigation.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import type { PhotoLibraryQueryV2 } from '../src/common/editor/photo-library-query-port-v2.ts';
import type { PhotoLibraryPageV1, PhotoLibraryQueryStepV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import type { PhotoLibraryCullReceiptV1 } from '../src/common/editor/controller/shared/photo-library-culling-v1.ts';
import { seedCurrentAppPhoto, currentAppLocks } from './helpers/lightscaper-current-app-fixture.tsx';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
interface Slot { live: boolean; page: Readonly<PhotoLibraryPageV1> | null; query: PhotoLibraryQueryV2; savedCollectionId: string | null; stackCollapsed: boolean; }

/** Real selected Current Session, indexed smart predicate and committed Original.
 * Hooks hold/refuse only after actual native reads; they supply no page or ACK. */
async function fixture(kind: 'query' | 'saved' = 'query') {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory, currentAppLocks());
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, preferOpfs: false, locks: null });
	const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native.factory, verifyOriginal: media.verifyOriginal });
	let owner: Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>> | undefined;
	try {
		const root = await catalog.loadCatalog(seeded.photo.catalogId); assert.ok(root);
		await catalog.saveCatalog({ ...root, collections: [{ id: 'eligible', name: 'Eligible ratings', kind: 'smart',
			query: { kind: 'rating', minimum: 4, maximum: 5 } }] }, root.revision);
		const query = normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', text: '',
			filter: { kind: 'collection', id: 'eligible' }, sort: { field: 'photo-id', direction: 'ascending' }, predicate: null });
		if (kind === 'saved') {
			const state = await catalog.readSmartCollectionSnapshotV1(root.id, null);
			await catalog.saveSmartCollection({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: root.id, id: 'saved',
				revision: 0, name: 'Eligible saved query', query }, null, { expectedCatalogRevision: state.context.catalogRevision,
				expectedIndexRevision: state.context.indexRevision, expectedStateRevision: state.context.collectionStateRevision });
		}
		owner = await createPhotoLibrarySessionCurrentV1(seeded.options); const current = owner;
		await current.setRating(seeded.photo.id, 5);
		for (let step = 0; step < 4; step++) { if ((await current.rebuildQueryStepV2()).ready) break; assert.notEqual(step, 3, 'One-photo index must complete within four bounded native steps.'); }
		const slot: Slot = { live: true, page: null, query, savedCollectionId: kind === 'saved' ? 'saved' : null, stackCollapsed: false };
		slot.page = await readVisiblePage(current, slot, null, new AbortController().signal);
		assert.deepEqual(slot.page.rows.map(row => row.id), [seeded.photo.id]); assert.equal(slot.page.cursor, null);
		const before = await catalog.loadPhoto(root.id, seeded.photo.id); assert.ok(before);
		const hooks = { query: async (_page: Readonly<PhotoLibraryQueryStepV1>): Promise<void> => undefined,
			destination: async (_page: Readonly<PhotoLibraryPageV1> | null): Promise<void> => undefined };
		const navigation = current.cullingNavigation; assert.ok(navigation);
		const destination = navigation.readDestinationPage, queryRead = current.readQueryStepV2;
		let queryReads = 0, destinationReads = 0;
		Object.defineProperty(current, 'cullingNavigation', { configurable: true, value: Object.freeze({
			async readDestinationPage(...args: Parameters<typeof destination>) {
				const page = await Reflect.apply(destination, navigation, args); destinationReads++; await hooks.destination(page); return page;
			} }) });
		Object.defineProperty(current, 'readQueryStepV2', { configurable: true, value: async (...args: Parameters<typeof queryRead>) => {
			const page = await Reflect.apply(queryRead, current, args); queryReads++; await hooks.query(page); return page;
		} });
		const saved = current.savedCollections, savedRead = saved.readQueryStep;
		Object.defineProperty(current, 'savedCollections', { configurable: true, value: Object.freeze({ ...saved,
			async readQueryStep(...args: Parameters<typeof savedRead>) {
				const page = await Reflect.apply(savedRead, saved, args); queryReads++; await hooks.query(page); return page;
			} }) });
		const failures: unknown[] = [], published: Readonly<PhotoLibraryPageV1>[] = [], pending = new Set<Promise<unknown>>();
		const workflow = createPhotoLibraryCullingWorkflowV1<Slot>({ getCurrent: () => slot, isCurrent: value => value === slot && slot.live,
			publishPage(value, page) { if (value !== slot || !slot.live) return null; slot.page = page; if (page) published.push(page); return page; },
			async perform(run, signal) {
				try { await run(current, signal ?? new AbortController().signal, slot); return 'completed'; }
				catch (error) { failures.push(error); return 'failed'; }
			} });
		const rate = (signal?: AbortSignal) => {
			const work = workflow.setRating(seeded.photo.id, 2, signal ? { signal } : {}); pending.add(work);
			void work.then(() => pending.delete(work), () => pending.delete(work)); return work;
		};
		return { native, seeded, catalog, media, owner: current, slot, before, hooks, failures, published, rate,
			counts: () => ({ queryReads, destinationReads }),
			async verifySaved() {
				const photo = await catalog.loadPhoto(root.id, seeded.photo.id); assert.ok(photo);
				assert.deepEqual(photo, { ...before, rating: 2, revision: before.revision + 1 }); await media.verifyOriginal(photo.original);
				const body = await media.mediaRepository.loadAsset(photo.original.storageKey); assert.ok(body instanceof Blob);
				assert.deepEqual([...new Uint8Array(await body.arrayBuffer())], [1, 2, 3]);
			},
			async close() { await Promise.allSettled([...pending]); await Promise.all([current.close(), catalog.close(), media.close()]); },
		};
	} catch (error) { await Promise.allSettled([owner?.close(), catalog.close(), media.close()]); throw error; }
}

function saved(receipt: PhotoLibraryCullReceiptV1) {
	if (receipt.outcome !== 'saved') assert.fail('The genuine native rating ACK must remain saved.'); return receipt;
}
for (const kind of ['query', 'saved'] as const) test(`actual Current ${kind} rating edit publishes the genuinely empty exhausted query with its catalog count and saved ACK`, async () => {
	const f = await fixture(kind);
	try {
		const receipt = saved(await f.rate()); assert.equal(receipt.notice, null); assert.equal(receipt.page, f.slot.page);
		assert.ok(receipt.page); assert.deepEqual(receipt.page.rows, []); assert.equal(receipt.page.cursor, null); assert.equal(receipt.page.totalCount, 1);
		assert.deepEqual(f.counts(), { destinationReads: 1, queryReads: 1 }); assert.deepEqual(f.failures, []);
		assert.equal(f.published.length, 1); assert.equal(f.published[0], receipt.page); await f.verifySaved();
	} finally { await f.close(); }
});

test('all old anchors disappearing refreshes a genuine new matching row rather than fabricating an empty page', async () => {
	const f = await fixture();
	try {
		const next = normalizePhotoDocumentV1({ ...f.seeded.photo, id: 'new-match', rating: 5 }), root = await f.catalog.loadCatalog(next.catalogId); assert.ok(root);
		await f.catalog.publishPhotos(root.id, root.revision, [next]);
		await f.media.mediaRepository.catalogOriginals.retain(root.id, [{ photoId: next.id, assetId: next.original.storageKey,
			sourceId: next.original.id, sha256: next.original.contentSha256, size: next.original.byteLength }]);
		const receipt = saved(await f.rate()); assert.equal(receipt.notice, null); assert.equal(receipt.page, f.slot.page);
		assert.deepEqual(receipt.page?.rows.map(row => row.id), [next.id]); assert.equal(receipt.page?.totalCount, 2); assert.equal(receipt.page?.cursor, null);
		assert.deepEqual(f.counts(), { destinationReads: 1, queryReads: 1 }); assert.deepEqual(f.failures, []); await f.verifySaved();
	} finally { await f.close(); }
});

test('an actual native destination refusal is never recast as an empty query', async () => {
	const f = await fixture(), failure = Symbol('native destination refused'); f.hooks.destination = async () => { throw failure; };
	try {
		const receipt = saved(await f.rate()); assert.equal(receipt.notice, 'refresh-failed'); assert.equal(receipt.page, null);
		assert.equal(f.failures.at(-1), failure); assert.equal(f.counts().queryReads, 0); assert.equal(f.slot.page?.rows[0]?.rating, 2); await f.verifySaved();
	} finally { await f.close(); }
});

test('a failure after the actual empty query read retains the exact refusal and durable fallback instead of publishing empty', async () => {
	const f = await fixture(), failure = Symbol('native query return refused'); f.hooks.query = async () => { throw failure; };
	try {
		const receipt = saved(await f.rate()); assert.equal(receipt.notice, 'refresh-failed'); assert.equal(receipt.page, null);
		assert.equal(f.failures.at(-1), failure); assert.equal(f.counts().queryReads, 1); assert.equal(f.slot.page?.rows[0]?.rating, 2);
		assert.ok(f.published.every(page => page.rows.length === 1)); await f.verifySaved();
	} finally { await f.close(); }
});

for (const change of ['definition', 'epoch', 'cancel'] as const) test(`held actual empty query cannot publish across a changed ${change} fence`, { timeout: 15_000 }, async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Symbol('cancelled refresh');
	f.hooks.query = async page => { assert.deepEqual(page.rows, []); entered.resolve(); await release.promise; };
	const initial = f.slot.page, work = f.rate(stop.signal);
	try {
		const reached = await Promise.race([entered.promise.then(() => true), work.then(() => false)]); assert.equal(reached, true);
		assert.equal(await remainsPending(work), true); assert.equal(f.slot.page, initial); assert.equal(f.published.length, 0);
		if (change === 'definition') {
			const root = await f.catalog.loadCatalog(f.before.catalogId); assert.ok(root);
			await f.catalog.saveCatalog({ ...root, collections: [{ id: 'eligible', name: 'Eligible ratings', kind: 'smart',
				query: { kind: 'rating', minimum: 0, maximum: 5 } }] }, root.revision);
		} else if (change === 'epoch') f.slot.live = false;
		else stop.abort(reason);
		release.resolve(); const receipt = saved(await work); assert.equal(receipt.notice, 'refresh-failed'); assert.equal(receipt.page, null);
		assert.ok(f.published.every(page => page.rows.length === 1));
		if (change === 'epoch') { assert.equal(f.slot.page, initial); assert.deepEqual(f.published, []); }
		else assert.equal(f.slot.page?.rows[0]?.rating, 2);
		if (change === 'cancel') assert.equal(f.failures.at(-1), reason);
		else assert.match(String(f.failures.at(-1)), change === 'definition' ? /query definition changed/u : /selection changed/u);
		await f.verifySaved();
	} finally { release.resolve(); await work; await f.close(); }
});
