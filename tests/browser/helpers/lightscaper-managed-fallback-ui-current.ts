/* SPDX-License-Identifier: AGPL-3.0-only */
import { request, transact } from '../../../src/common/editor/storage/indexeddb-backend.ts';
import type { StorageRecord } from '../../../src/common/editor/storage/media-records.ts';
import { normalizeCatalogOriginalRoot } from '../../../src/common/editor/storage/media-catalog-original-schema.ts';
import { digestMediaContent } from '../../../src/common/editor/storage/media-content-digest.ts';
import { mediaAssetChunkKey } from '../../../src/common/editor/storage/media-asset-chunk-records.ts';
import { MEDIA_ASSET_CHUNK_STORE_NAME, MEDIA_ASSET_CHUNK_STORAGE_TYPE, MEDIA_ASSET_STREAM_CHUNK_BYTES } from '../../../src/common/editor/storage/media-asset-chunk-schema.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../../../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoMediaStoreV1 } from '../../../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../../../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { verifyPhotoResourcesCurrentV1 } from '../../../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';

/** Read only the real UI's one-photo library. No initializer, publisher, custom
 * decoder, fake storage, OPFS witness or application capability is installed. */
export async function readManagedFallbackUiPhotoCurrentV1(photoId: string) {
	check(typeof photoId === 'string' && photoId.length > 0 && photoId.length <= 256, 'Fallback observation requires one actual Photo ID.');
	const anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, preferOpfs: false, syncWorkerClient: null });
	let media: PhotoMediaStoreV1 | null = null, catalog: PhotoCatalogRepositoryCurrentV1 | null = null, database: IDBDatabase | null = null;
	let result: Awaited<ReturnType<typeof read>> | undefined, failed = false, primary: unknown;
	const physicalCopies: Uint8Array[] = [];
	async function read() {
		await anchor.ready(); const selected = await selection(), { location } = selected;
		media = selected.allocation ? new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks,
			databaseName: location.mediaDatabaseName, preferOpfs: false, syncWorkerClient: null }) : anchor;
		await media.ready(); const selectedMedia = media;
		const verify = (photo: unknown, signal?: AbortSignal) => verifyPhotoResourcesCurrentV1(photo, {
			cubeLutResources: () => selectedMedia.getCubeLutResources(), maskRasterResources: () => selectedMedia.getMaskRasterResources(),
		}, signal);
		catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB, databaseName: location.catalogDatabaseName,
			verifyOriginal: selectedMedia.verifyOriginal, verifyResources: verify });
		const root = await catalog.loadCatalog(location.catalogId), photo = await catalog.loadPhoto(location.catalogId, photoId);
		check(root !== null && root.photoCount === 1 && photo !== null && photo.original.byteLength <= 4096, 'Fallback UI requires exactly one tiny committed Photo.');
		await media.verifyOriginal(photo.original); await verify(photo);
		database = await openExisting(location.mediaDatabaseName);
		const retained = await transact(database, ['mediaAssets', 'catalogOriginalRoots', MEDIA_ASSET_CHUNK_STORE_NAME], 'readonly', async stores => {
			const assets = stores.mediaAssets, roots = stores.catalogOriginalRoots, chunkStore = stores[MEDIA_ASSET_CHUNK_STORE_NAME];
			check(assets !== undefined && roots !== undefined && chunkStore !== undefined, 'Actual fallback stores are missing.');
			const row = await request<StorageRecord | undefined>(assets.get(photo.original.storageKey));
			const values = await request<unknown[]>(roots.index('assetId').getAll(photo.original.storageKey, 2));
			check(row !== undefined && row.storage === MEDIA_ASSET_CHUNK_STORAGE_TYPE && row.sourceId === photo.original.storageKey
				&& row.sha256 === photo.original.contentSha256 && row.size === photo.original.byteLength
				&& typeof row.mediaChunkToken === 'string' && row.mediaChunkToken.length > 0 && row.mediaChunkCount === 1
				&& row.mediaChunkBytes === MEDIA_ASSET_STREAM_CHUNK_BYTES && !Object.hasOwn(row, 'blob') && row.catalogRootCount === 1,
				'UI Original must be a genuine complete IndexedDB byte-chunk row.');
			const chunks = await request<Record<string, unknown>[]>(chunkStore.index('mediaChunkToken').getAll(row.mediaChunkToken, 2));
			for (const chunk of chunks) if (chunk?.payloadBytes instanceof ArrayBuffer) physicalCopies.push(new Uint8Array(chunk.payloadBytes));
			check(chunks.length === 1, 'UI fallback Original must own exactly one tiny physical chunk.');
			const chunk = chunks[0]!;
			check(chunk.key === mediaAssetChunkKey(row.mediaChunkToken, 0) && chunk.sourceId === photo.original.storageKey
				&& chunk.mediaChunkToken === row.mediaChunkToken && chunk.index === 0 && chunk.byteLength === photo.original.byteLength
				&& chunk.payloadEncoding === 'array-buffer-v1' && chunk.payloadBytes instanceof ArrayBuffer
				&& chunk.payloadBytes.byteLength === photo.original.byteLength && !Object.hasOwn(chunk, 'payload'),
				'UI fallback Original must retain its exact native IndexedDB byte payload.');
			check(values.length === 1, 'UI fallback Original custody is not complete.');
			const custody = normalizeCatalogOriginalRoot(values[0]);
			check(custody.catalogId === photo.catalogId && custody.photoId === photo.id && custody.importId === null
				&& custody.assetId === photo.original.storageKey && custody.sourceId === photo.original.id
				&& custody.sha256 === photo.original.contentSha256 && custody.size === photo.original.byteLength
				&& custody.mediaContentToken === row.mediaContentToken, 'Actual fallback Root1 binding differs.');
			return { bytes: chunk.payloadBytes, custody };
		});
		const physical = new Uint8Array(retained.bytes);
		try {
			const body = await media.mediaRepository.loadAsset(photo.original.storageKey, { expectedSize: photo.original.byteLength });
			check(body !== null && body.size === photo.original.byteLength, 'Actual fallback body is not readable through the media owner.');
			const bytes = new Uint8Array(await body.arrayBuffer());
			try { check(bytes.length === physical.length && bytes.every((value, index) => value === physical[index]), 'Actual fallback read differs from its physical chunk.'); }
			finally { bytes.fill(0); }
			const bodySha256 = await digestMediaContent(body, { chunkBytes: 4096 });
			check(bodySha256 === photo.original.contentSha256, 'Actual fallback body digest differs.');
			check(JSON.stringify((await selection()).pointer) === JSON.stringify(selected.pointer), 'Fallback selected library changed during observation.');
			return { photo, catalogRevision: root.revision, namespace: location.namespaceToken,
				storage: MEDIA_ASSET_CHUNK_STORAGE_TYPE, bodySha256, bodyByteLength: body.size, custody: retained.custody };
		} finally { physical.fill(0); }
	}
	function selection() {
		return withPhotoLibraryInitializationLockV1(navigator.locks, () => readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw new Error('Fallback observation cannot initialize a library.'); } }));
	}
	try { result = await read(); } catch (error) { failed = true; primary = error; }
	for (const bytes of physicalCopies) bytes.fill(0);
	// transact joins native completion on success and abort before rethrow on
	// failure. Close this independent read connection and every real owner.
	const cleanup: unknown[] = [];
	try { closeReadConnection(); } catch (error) { cleanup.push(error); }
	const closed = await Promise.allSettled([...new Set([catalog, media, anchor])].filter(owner => owner !== null).map(owner => owner.close()));
	cleanup.push(...closed.flatMap(item => item.status === 'rejected' ? [item.reason as unknown] : []).filter(error => !failed || !Object.is(error, primary)));
	if (cleanup.length) throw new AggregateError(failed ? [primary, ...cleanup] : cleanup, 'Fallback observation or joined cleanup failed.', failed ? { cause: primary } : undefined);
	if (failed) throw primary;
	check(result !== undefined, 'Actual fallback observation did not finish.'); return result;
	function closeReadConnection() { database?.close(); }
}

async function openExisting(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const opening = indexedDB.open(name);
		opening.addEventListener('upgradeneeded', () => { opening.transaction?.abort(); }, { once: true });
		opening.addEventListener('error', () => { reject(opening.error); }, { once: true });
		opening.addEventListener('success', () => { resolve(opening.result); }, { once: true });
	});
}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
