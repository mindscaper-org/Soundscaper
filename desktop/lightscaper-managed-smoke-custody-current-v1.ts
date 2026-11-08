/* SPDX-License-Identifier: AGPL-3.0-only */

import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { readValidatedPhotoCatalogRootV1 } from '../src/lightscaper/catalog/documents.ts';
import { readStoredPhotoCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-records-current-v1.ts';
import { normalizeOpfsWorkerPath } from '../src/common/editor/storage/opfs-sync-worker-protocol.ts';
import { mediaAssetChunkKey, mediaAssetChunkRecord } from '../src/common/editor/storage/media-asset-chunk-records.ts';
import { MEDIA_ASSET_CHUNK_STORE_NAME, MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME, MEDIA_ASSET_CHUNK_STORAGE_TYPE,
	MEDIA_ASSET_STREAM_CHUNK_BYTES } from '../src/common/editor/storage/media-asset-chunk-schema.ts';
import { lightscaperSmokeStableJsonCurrentV1, type LightscaperSmokeCustodyCurrentV1, type LightscaperSmokeFileCurrentV1 } from './lightscaper-managed-smoke-contract-current-v1.ts';

/** Native readonly observation only: no repository constructors, initializer,
 * retention-session writes, reconciliation, decoding or worker composition.
 * Missing databases abort their version-change transaction; OPFS lookups never
 * create directories/files. Every connection closes after its reads complete. */
export async function readLightscaperManagedSmokeCustodyCurrentV1(photoIds: readonly string[], fixtures: readonly LightscaperSmokeFileCurrentV1[]): Promise<LightscaperSmokeCustodyCurrentV1> {
	if (photoIds.length !== 2 || new Set(photoIds).size !== 2 || fixtures.length !== 2) throw new RangeError('Managed desktop smoke requires exactly two imported photos.');
	const opened = new Set<IDBDatabase>();
	try {
		const anchor = await openLightscaperSmokeExistingDatabaseCurrentV1(indexedDB, 'lightscaper-photo-media-v2'); opened.add(anchor);
		const selection = await readPhotoLibrarySessionLocationV2({ settings: { async get(key: string): Promise<unknown> {
			const row = await readRow(anchor, 'settings', key);
			return row === undefined ? undefined : dataRecord(row, 'Photo settings row').value;
		} }, initializeDefault: async () => { throw new Error('Smoke observer cannot initialize a Photo Library.'); } });
		const catalog = await openLightscaperSmokeExistingDatabaseCurrentV1(indexedDB, selection.location.catalogDatabaseName); opened.add(catalog);
		const media = selection.location.mediaDatabaseName === anchor.name ? anchor
			: await openLightscaperSmokeExistingDatabaseCurrentV1(indexedDB, selection.location.mediaDatabaseName); opened.add(media);
		const root = readValidatedPhotoCatalogRootV1(await readRow(catalog, 'catalogs', selection.location.catalogId));
		if (root.id !== selection.location.catalogId || root.photoCount !== 2) throw new Error('Managed desktop Photo Library root is incomplete.');
		const photos = [];
		for (const id of photoIds) {
			const key = `${root.id}|${id}`;
			const document = readStoredPhotoCurrentV1(await readRow(catalog, 'photos', key), key);
			const fixture = fixtures.find(value => value.name === document.metadata.fileName);
			if (!fixture) throw new Error('Managed desktop Original is outside its owned fixture.');
			const body = await readLightscaperSmokeOriginalBodyCurrentV1(await readRow(media, 'mediaAssets', document.original.storageKey), document.original, fixture, undefined,
				{ count: token => countChunks(media, token), read: key => readRow(media, MEDIA_ASSET_CHUNK_STORE_NAME, key) });
			photos.push({ document, ...body });
		}
		photos.sort((a, b) => a.document.metadata.fileName.localeCompare(b.document.metadata.fileName, 'en'));
		const fingerprint = await browserSha256(new TextEncoder().encode(lightscaperSmokeStableJsonCurrentV1({ root,
			photos: photos.map(({ document, sha256, byteLength }) => ({ document, sha256, byteLength })) })));
		return { root, namespace: selection.location.namespaceToken, photos, fingerprint };
	} finally { for (const database of opened) database.close(); }
}

export function openLightscaperSmokeExistingDatabaseCurrentV1(factory: IDBFactory, name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = factory.open(name); let refused = false;
		request.onupgradeneeded = () => { request.transaction?.abort(); };
		request.onerror = () => { reject(request.error ?? new Error('Managed desktop database is absent.')); };
		request.onblocked = () => { refused = true; reject(new Error('Managed desktop readonly database open was blocked.')); };
		request.onsuccess = () => {
			const database = request.result;
			if (refused) { database.close(); return; }
			database.onversionchange = () => { database.close(); };
			resolve(database);
		};
	});
}

function readRow(database: IDBDatabase, store: string, key: string): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const transaction = database.transaction(store, 'readonly');
		const request: IDBRequest<unknown> = transaction.objectStore(store).get(key);
		let value: unknown;
		request.onsuccess = () => { value = request.result; };
		transaction.oncomplete = () => { resolve(value); };
		transaction.onabort = () => { reject(transaction.error ?? request.error ?? new Error('Managed desktop readonly observation aborted.')); };
		transaction.onerror = () => { /* Native abort owns the terminal rejection. */ };
	});
}

export async function readLightscaperSmokeOriginalBodyCurrentV1(metadataValue: unknown,
	original: Readonly<{ storageKey: string; byteLength: number; contentSha256: string; retention: string }>,
	fixture: LightscaperSmokeFileCurrentV1, opfsRoot: () => Promise<FileSystemDirectoryHandle> = () => navigator.storage.getDirectory(),
	chunks?: LightscaperSmokeChunkReadPortsCurrentV1,
): Promise<Readonly<{ byteLength: number; sha256: string; storage: string }>> {
	const metadata = dataRecord(metadataValue, 'Photo media asset');
	if (fixture.byteLength < 1 || fixture.byteLength > 65_536 || !Number.isSafeInteger(fixture.byteLength)
		|| metadata.sourceId !== original.storageKey || metadata.sha256 !== fixture.sha256 || metadata.size !== fixture.byteLength
		|| original.byteLength !== fixture.byteLength || original.contentSha256 !== fixture.sha256 || original.retention !== 'managed') {
		throw new Error('Managed desktop Original media identity changed.');
	}
	let body: Blob;
	if (metadata.storage === 'opfs') {
		const path = normalizeOpfsWorkerPath(metadata.path);
		const directory = await (await opfsRoot()).getDirectoryHandle('lightscaper-photo-originals', { create: false });
		body = await (await directory.getFileHandle(path, { create: false })).getFile();
	} else if (metadata.storage === 'indexeddb-blob' && metadata.blob instanceof Blob) body = metadata.blob;
	else if (metadata.storage === MEDIA_ASSET_CHUNK_STORAGE_TYPE && chunks) body = await readLightscaperSmokeChunkBodyCurrentV1(metadata, chunks);
	else throw new Error('Managed desktop Original body is missing.');
	if (body.size !== fixture.byteLength) throw new Error('Managed desktop Original body length changed.');
	const bytes = new Uint8Array(await body.arrayBuffer());
	let sha256: string;
	try { sha256 = await browserSha256(bytes); } finally { bytes.fill(0); }
	if (sha256 !== fixture.sha256) throw new Error('Managed desktop Original body digest changed.');
	return { byteLength: body.size, sha256, storage: metadata.storage };
}

interface LightscaperSmokeChunkReadPortsCurrentV1 {
	count(token: string): Promise<number>;
	read(key: string): Promise<unknown>;
}
/** This fixture's complete body fits one canonical chunk. Count the native
 * token index as well as checking its record, so extra bodies cannot hide. */
export async function readLightscaperSmokeChunkBodyCurrentV1(value: unknown, ports: LightscaperSmokeChunkReadPortsCurrentV1): Promise<Blob> {
	const metadata = dataRecord(value, 'Restored media metadata'), token = metadata.mediaChunkToken, size = metadata.size;
	if (typeof token !== 'string' || !token || token.length > 256 || typeof metadata.sourceId !== 'string' || !metadata.sourceId
		|| typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1 || size > 65_536
		|| metadata.mediaChunkCount !== 1 || metadata.mediaChunkBytes !== MEDIA_ASSET_STREAM_CHUNK_BYTES) throw new Error('Restored media chunk geometry is invalid.');
	if (await ports.count(token) !== 1) throw new Error('Restored media chunk inventory changed.');
	const key = mediaAssetChunkKey(token, 0), chunk = mediaAssetChunkRecord(await ports.read(key));
	if (!chunk || chunk.key !== key || chunk.sourceId !== metadata.sourceId || chunk.mediaChunkToken !== token
		|| chunk.index !== 0 || chunk.byteLength !== size || chunk.payload.size !== size) throw new Error('Restored media chunk ownership changed.');
	return chunk.payload;
}
function countChunks(database: IDBDatabase, token: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const transaction = database.transaction(MEDIA_ASSET_CHUNK_STORE_NAME, 'readonly');
		const request = transaction.objectStore(MEDIA_ASSET_CHUNK_STORE_NAME).index(MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME).count(token);
		let count = 0; request.onsuccess = () => { count = request.result; };
		transaction.oncomplete = () => { resolve(count); };
		transaction.onabort = () => { reject(transaction.error ?? new Error('Restored media inventory observation aborted.')); };
	});
}
function dataRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} requires a native record.`);
	return value as Readonly<Record<string, unknown>>;
}
export async function browserSha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
	return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
