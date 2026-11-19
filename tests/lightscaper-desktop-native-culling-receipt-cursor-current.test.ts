/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LightscaperNativeCatalogStoreCurrentV1 as Store } from '../desktop/lightscaper-native-catalog-store-current-v1.ts';
import { PhotoLibraryCullingV1, type PhotoLibraryCullReceiptV1 } from '../src/common/editor/controller/shared/photo-library-culling-v1.ts';
import { createPhotoLibraryCullingWorkflowV1 } from '../src/common/editor/controller/shared/photo-library-culling-workflow-v1.ts';
import { PhotoLibrarySelectionV1 } from '../src/common/editor/controller/shared/photo-library-selection-v1.ts';
import { PHOTO_LIBRARY_SAVED_COLLECTION_LIMITS_V1 } from '../src/common/editor/photo-library-saved-collection-port-v1.ts';
import type { PhotoLibrarySessionPortV2 } from '../src/common/editor/photo-library-session-port-v2.ts';
import type { PhotoLibraryPageV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import type { PhotoLibraryCullingNavigationContextV1, PhotoLibraryCullingNavigationPortV1 } from '../src/common/editor/photo-library-culling-navigation-port-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { readPhotoLibraryQueryStepV2 } from '../src/lightscaper/controller/photo-library-query-v2.ts';
import { readPhotoLibrarySavedSnapshotV1, readPhotoLibrarySavedQueryStepV1 } from '../src/lightscaper/controller/photo-library-saved-collection-read-v1.ts';
import { admitPhotoLibrarySavedSnapshotRequestV1, admitPhotoLibrarySavedQueryRequestV1 } from '../src/lightscaper/controller/photo-library-saved-collection-admission-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

const CATALOG = 'catalog-' + 'c'.repeat(120), COLLECTION = 'saved-' + 's'.repeat(122);
const query = normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', sort: { field: 'file-name', direction: 'ascending' } });
const photoId = (index: number) => `photo-${String(index).padStart(3, '0')}-` + 'p'.repeat(118);
type Mode = 'query' | 'saved';
function destination(store: Store, context: PhotoLibraryCullingNavigationContextV1,
	request: Parameters<PhotoLibraryCullingNavigationPortV1['readDestinationPage']>[1]): Promise<Readonly<PhotoLibraryPageV1> | null> {
	const method: unknown = Reflect.get(store, 'readCullingDestinationPage'); assert.equal(typeof method, 'function');
	return Reflect.apply(method as (...args: unknown[]) => Promise<Readonly<PhotoLibraryPageV1> | null>, store, [CATALOG, context, request]);
}
async function fixture(mode: Mode, run: (value: {
	store: Store; selection: PhotoLibrarySelectionV1; culling: PhotoLibraryCullingV1;
	workflow: Pick<ReturnType<typeof createPhotoLibraryCullingWorkflowV1>, 'setRating'>; currentPage: () => PhotoLibraryPageV1 | null; saves: () => number;
}) => Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper culling receipt cursor ü '))), store = await Store.open({ appDataPath: directory });
	try {
		const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: CATALOG,
			name: 'Wide native cursor', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
		await store.createCatalog(root); let revision = 0;
		const photos = Array.from({ length: 65 }, (_, index) => {
			const photo = photoArchiveFixture(index).photo;
			return normalizePhotoDocumentCurrentV1({ ...photo, catalogId: CATALOG, id: photoId(index),
				metadata: { ...photo.metadata, fileName: '\ud800'.repeat(256) } });
		});
		for (const photo of photos) await store.storeOriginal(photo.original, (async function* () { yield Uint8Array.of(1, 2, 3); })());
		for (let index = 0; index < photos.length; index += 16) revision = (await store.publishPhotos(CATALOG, revision, photos.slice(index, index + 16))).revision;
		await store.saveSmartCollection({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: CATALOG, id: COLLECTION,
			name: 'Wide saved cursor', revision: 0, query }, null, { expectedCatalogRevision: revision, expectedIndexRevision: revision, expectedStateRevision: 0 });
		const context: PhotoLibraryCullingNavigationContextV1 = mode === 'saved' ? { kind: 'saved', collectionId: COLLECTION, collapsed: false }
			: { kind: 'query', query, collapsed: false };
		const initial = await destination(store, context, { photoId: photoId(0) }); assert.ok(initial && initial.cursor);
		assert.ok(Buffer.byteLength(initial.cursor, 'utf8') > 2048); assert.ok(Buffer.byteLength(initial.cursor, 'utf8') <= PHOTO_LIBRARY_SAVED_COLLECTION_LIMITS_V1.maximumCursorBytes);
		const selection = new PhotoLibrarySelectionV1(); selection.setPage(initial.rows.map(row => row.id), { generation: store, pageIdentity: initial }); selection.select(photoId(0));
		const culling = new PhotoLibraryCullingV1(selection), slot = { live: true, page: initial as PhotoLibraryPageV1 | null,
			query: mode === 'query' ? query : null, savedCollectionId: mode === 'saved' ? COLLECTION : null, stackCollapsed: false };
		let saves = 0;
		const unused = async (): Promise<never> => { throw Error('Unexpected unrelated capability in native receipt boundary fixture.'); };
		// Test-only thin borrowed ports call real native writes/reads and owning
		// scalar adapters. This is not a new Session factory or fake repository.
		const ports = {
			async setRating(id: string, rating: number, options: Readonly<{ signal?: AbortSignal }> = {}) {
				const photo = await store.loadPhoto(CATALOG, id); assert.ok(photo); const saved = await store.savePhoto({ ...photo, rating }, photo.revision, options); saves++;
				return Object.freeze({ id: saved.id, fileName: saved.metadata.fileName, width: saved.original.width, height: saved.original.height,
					rating: saved.rating, flag: saved.flag, colorLabel: saved.colorLabel });
			},
			cullingNavigation: { readDestinationPage: (selected: PhotoLibraryCullingNavigationContextV1,
				request: Parameters<PhotoLibraryCullingNavigationPortV1['readDestinationPage']>[1]) => destination(store, selected, request) },
			readPage: unused, readQueryStep: unused, readStackQueryStep: unused, readQueryStepV2: unused, readStackQueryStepV2: unused,
			...(mode === 'saved' ? { savedCollections: { readPage: unused, apply: unused,
				readSnapshot: (options: unknown) => readPhotoLibrarySavedSnapshotV1(store, CATALOG, admitPhotoLibrarySavedSnapshotRequestV1(options)),
				readQueryStep: (options: unknown) => readPhotoLibrarySavedQueryStepV1(store, CATALOG, admitPhotoLibrarySavedQueryRequestV1(options)) } } : {})
		} as unknown as Omit<PhotoLibrarySessionPortV2, 'develop'>;
		const workflow = createPhotoLibraryCullingWorkflowV1({
			async perform(action, signal) { try { await action(ports, signal ?? new AbortController().signal, slot); return 'completed'; } catch { return signal?.aborted ? 'cancelled' : 'failed'; } },
			publishPage(_current, next) { slot.page = next; return next; }, getCurrent: () => slot, isCurrent: current => current === slot
		});
		await run({ store, selection, culling, workflow, currentPage: () => slot.page, saves: () => saves }); await culling.drain();
	} finally { await store.close(); }
	// Root owns failed diagnostic directories until the full verification process joins.
	await rm(directory, { recursive: true, force: false });
}

for (const mode of ['query', 'saved'] as const) test(`Lightscaper real culling workflow keeps ${mode} native4KiB cursor ACK page identity selection and resumability`, async () => {
	await fixture(mode, async ({ store, culling, selection, workflow, currentPage, saves }) => {
		const receipt = await culling.execute(photoId(0), signal => workflow.setRating(photoId(0), 4, { signal }), { autoAdvance: false });
		assert.equal(receipt.outcome, 'saved'); if (receipt.outcome !== 'saved' || receipt.page === null) assert.fail('The genuine committed edit needs its native destination page.');
		assert.equal(receipt.page, currentPage()); assert.equal(receipt.notice, null); assert.ok(receipt.page.cursor); assert.equal(saves(), 1);
		assert.ok(Buffer.byteLength(receipt.page.cursor, 'utf8') > 2048); assert.ok(Buffer.byteLength(receipt.page.cursor, 'utf8') <= PHOTO_LIBRARY_SAVED_COLLECTION_LIMITS_V1.maximumCursorBytes);
		assert.deepEqual(selection.snapshot().selectedIds, [photoId(0)]); assert.equal(selection.snapshot().focusedId, photoId(0));
		const selected = await store.loadPhoto(CATALOG, photoId(0)); assert.equal(selected?.rating, 4); assert.equal(selected?.revision, 1);
		const resumed = mode === 'query' ? await readPhotoLibraryQueryStepV2(store, CATALOG, { query, cursor: receipt.page.cursor })
			: await readPhotoLibrarySavedQueryStepV1(store, CATALOG, admitPhotoLibrarySavedQueryRequestV1({ collectionId: COLLECTION, mode: 'ordinary', cursor: receipt.page.cursor }));
		assert.deepEqual(resumed.rows.map(row => row.id), [photoId(64)]); assert.equal(culling.snapshot().pendingPhotoId, null);
	});
});

test('Lightscaper culling receipt refuses above4KiB UTF8 cursor bytes while keeping actual native write and selection separate', async () => {
	await fixture('query', async ({ store, culling, selection, workflow, saves }) => {
		const before = selection.snapshot();
		await assert.rejects(culling.execute(photoId(0), async signal => {
			const genuine = await workflow.setRating(photoId(0), 3, { signal }); assert.equal(genuine.outcome, 'saved');
			if (genuine.outcome !== 'saved' || genuine.page === null) assert.fail('Expected actual workflow receipt.');
			// Deliberately malformed borrowed receipt:2049 units,4098 UTF8 bytes.
			return Object.freeze({ ...genuine, page: Object.freeze({ ...genuine.page, cursor: 'é'.repeat(2049) }) }) as PhotoLibraryCullReceiptV1;
		}, { autoAdvance: false }));
		assert.deepEqual(selection.snapshot(), before); assert.equal(saves(), 1); assert.equal((await store.loadPhoto(CATALOG, photoId(0)))?.rating, 3);
	});
});
