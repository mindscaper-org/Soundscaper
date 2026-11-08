/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from '../../../src/common/media/indexeddb.ts';
import { digestMediaContent } from '../../../src/common/media/content-digest.ts';
import { mediaAssetChunkKey } from '../../../src/common/editor/storage/media-asset-chunk-records.ts';
import { MEDIA_ASSET_CHUNK_STORE_NAME, MEDIA_ASSET_CHUNK_STORAGE_TYPE, MEDIA_ASSET_STREAM_CHUNK_BYTES } from '../../../src/common/editor/storage/media-asset-chunk-schema.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../../../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoMediaStoreV1 } from '../../../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../../../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { compilePinnedLibRawModuleV1 } from '../../../src/common/editor/raw/libraw-runtime-asset-v1.ts';
import { decodeLibRawOriginalWasmV1 } from '../../../src/common/editor/raw/libraw-wasm-instance-v1.ts';
import { validatePhotoDevelopProxyCustodyV1 } from '../../helpers/lightscaper-develop-proxy-native-observer.ts';

let compiled: Promise<WebAssembly.Module> | undefined;
async function nativeModule() {
	compiled ??= (async () => {
		const response = await fetch('https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm', { credentials: 'omit', redirect: 'error', mode: 'cors' });
		check(response.ok, 'Pinned native RAW witness module is unavailable.');
		const bytes = new Uint8Array(await response.arrayBuffer());
		try { return await compilePinnedLibRawModuleV1(bytes); } finally { bytes.fill(0); }
	})();
	return compiled;
}

/** One fresh Photo, one durably retained Original and one independently opened native
 * decoder instance. This observer cannot import, publish, replace the app's
 * Session/Worker, or manufacture an eight-bit source. Its read-only media owner
 * reads actual OPFS or committed IndexedDB byte chunks, with no worker URL
 * rewriting. Native chunk readbacks are compared and wiped before returning. */
export async function readRawImportCustodyCurrentV1(photoId: string) {
	const anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, syncWorkerClient: null });
	let media: PhotoMediaStoreV1 | undefined, catalog: PhotoCatalogRepositoryCurrentV1 | undefined;
	let bytes: Uint8Array<ArrayBuffer> | undefined, pixels: Uint16Array<ArrayBuffer> | undefined;
	async function observe() {
		await anchor.ready();
		const selection = await withPhotoLibraryInitializationLockV1(navigator.locks, () => readPhotoLibrarySessionLocationV2({
			settings: anchor.settingsRepository, initializeDefault: async () => { throw new Error('RAW observer cannot initialize a library.'); },
		}));
		media = selection.location.mediaDatabaseName === 'lightscaper-photo-media-v2' ? anchor : new PhotoMediaStoreV1({
			indexedDB, locks: navigator.locks, databaseName: selection.location.mediaDatabaseName, syncWorkerClient: null });
		await media.ready(); const owner = media;
		catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB, databaseName: selection.location.catalogDatabaseName, verifyOriginal: owner.verifyOriginal });
		const photo = await catalog.loadPhoto(selection.location.catalogId, photoId); check(photo !== null, 'Imported Current RAW Photo missing.');
		const metadata = await owner.mediaRepository.getAssetMetadata(photo.original.storageKey);
		check(metadata !== null && (metadata.storage === 'opfs' || metadata.storage === MEDIA_ASSET_CHUNK_STORAGE_TYPE), 'RAW Original requires actual OPFS or IndexedDB byte-chunk storage.');
		const body = await owner.mediaRepository.loadAsset(photo.original.storageKey);
		check(body instanceof Blob && body.size <= 4096, 'RAW witness requires the complete bounded owned DNG.');
		bytes = new Uint8Array(await Blob.prototype.arrayBuffer.call(body));
		const sha256 = await digestMediaContent(body, { chunkBytes: 4096 }), native = await custody(selection.location.mediaDatabaseName, photo.original.storageKey, bytes);
		check(metadata.storage === native.record.storage && metadata.path === native.record.path, 'RAW public/native storage identities differ.');
		const publicRoots = await owner.mediaRepository.catalogOriginals.readPage({ catalogId: photo.catalogId });
		const original = validatePhotoDevelopProxyCustodyV1(photo, metadata, native.record, native.roots, publicRoots, sha256, body.size);
		const decoded = decodeLibRawOriginalWasmV1(await nativeModule(), bytes); pixels = decoded.frame.pixels;
		check(pixels.length === 4096 && decoded.frame.descriptor.width === 32 && decoded.frame.descriptor.height === 32,
			'RAW witness native dimensions exceed the owned fixture.');
		const words = Array.from(pixels), after = await custody(selection.location.mediaDatabaseName, photo.original.storageKey, bytes);
		check(JSON.stringify(after) === JSON.stringify(native), 'Native Original record or permanent custody changed during observation.');
		check(JSON.stringify(await catalog.loadPhoto(selection.location.catalogId, photoId)) === JSON.stringify(photo), 'Photo changed during RAW observation.');
		check(await digestMediaContent(body, { chunkBytes: 4096 }) === sha256, 'RAW Original bytes changed during native decode.');
		return { photo, original, namespace: selection.location.namespaceToken, bytes: Array.from(bytes),
			native: { descriptor: decoded.frame.descriptor, rawFlip: decoded.rawFlip, words } };
	}
	const outcome = await observe().then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	const errors: unknown[] = [];
	try { bytes?.fill(0); } catch (error) { errors.push(error); }
	try { pixels?.fill(0); } catch (error) { errors.push(error); }
	const owners = new Set([catalog, media, anchor]);
	const results = await Promise.allSettled([...owners].filter(owner => owner !== undefined).map(owner => Promise.resolve().then(() => owner.close())));
	for (const result of results) if (result.status === 'rejected') errors.push(result.reason as unknown);
	if (!outcome.ok) {
		if (errors.length) throw new AggregateError([outcome.error, ...errors], 'RAW custody observer failed and cleanup did not complete.', { cause: outcome.error });
		throw outcome.error;
	}
	if (errors.length) throw new AggregateError(errors, 'RAW custody observer cleanup did not complete.');
	return outcome.value;
}

async function custody(databaseName: string, storageKey: string, encoded: Uint8Array<ArrayBuffer>) {
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const opening = indexedDB.open(databaseName);
		opening.addEventListener('upgradeneeded', () => opening.transaction?.abort(), { once: true });
		opening.addEventListener('error', () => reject(opening.error), { once: true });
		opening.addEventListener('success', () => resolve(opening.result), { once: true });
	});
	const physicalCopies: Uint8Array<ArrayBuffer>[] = [];
	try {
		return await transact(database, ['mediaAssets', 'catalogOriginalRoots', MEDIA_ASSET_CHUNK_STORE_NAME], 'readonly', async stores => {
			check(stores.mediaAssets && stores.catalogOriginalRoots && stores[MEDIA_ASSET_CHUNK_STORE_NAME], 'Actual RAW native custody stores are missing.');
			const roots: unknown[] = await request(stores.catalogOriginalRoots.getAll(undefined, 2));
			check(roots.length === 1, 'RAW fixture requires exactly one complete Original custody root.');
			const record = await request<Record<string, unknown> | undefined>(stores.mediaAssets.get(storageKey));
			check(record !== undefined && record.sourceId === storageKey && record.size === encoded.byteLength, 'Actual RAW native Original identity differs.');
			if (record.storage === 'opfs') check(typeof record.path === 'string' && record.path.length > 0, 'Actual RAW OPFS path is missing.');
			else {
				check(record.storage === MEDIA_ASSET_CHUNK_STORAGE_TYPE && typeof record.mediaChunkToken === 'string' && record.mediaChunkToken.length > 0
					&& record.mediaChunkCount === 1 && record.mediaChunkBytes === MEDIA_ASSET_STREAM_CHUNK_BYTES && !Object.hasOwn(record, 'blob'), 'RAW Original must own its exact durable byte-chunk row.');
				const chunks = await request<Record<string, unknown>[]>(stores[MEDIA_ASSET_CHUNK_STORE_NAME].index('mediaChunkToken').getAll(record.mediaChunkToken, 2));
				for (const chunk of chunks) if (chunk?.payloadBytes instanceof ArrayBuffer) physicalCopies.push(new Uint8Array(chunk.payloadBytes));
				check(chunks.length === 1, 'RAW Original requires exactly one bounded physical byte chunk.');
				const chunk = chunks[0]!;
				check(chunk.key === mediaAssetChunkKey(record.mediaChunkToken, 0) && chunk.sourceId === storageKey && chunk.mediaChunkToken === record.mediaChunkToken
					&& chunk.index === 0 && chunk.byteLength === encoded.byteLength && chunk.payloadEncoding === 'array-buffer-v1' && !Object.hasOwn(chunk, 'payload')
					&& chunk.payloadBytes instanceof ArrayBuffer && chunk.payloadBytes.byteLength === encoded.byteLength, 'RAW native byte-chunk identity differs.');
				const physical = new Uint8Array(chunk.payloadBytes);
				check(encoded.every((value, index) => value === physical[index]), 'RAW loaded Original differs from its physical IndexedDB bytes.');
			}
			return { record, roots };
		});
	} finally { try { for (const copy of physicalCopies) copy.fill(0); } finally { database.close(); } }
}
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
