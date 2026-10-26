/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAbortGuard } from '../abort-error.ts';
import { readCursorPage, request, transact } from './indexeddb-backend.ts';
import { trustedMediaContentSha256 } from './media-content-provenance.ts';
import type { StorageRecord } from './media-records.ts';
import {
	CATALOG_ORIGINAL_ASSET_INDEX_NAME, CATALOG_ORIGINAL_COUNT_FIELD,
	CATALOG_ORIGINAL_ROOT_STORE_NAME, catalogOriginalKey, catalogOriginalScope,
	normalizeCatalogOriginalRoot,
	type CatalogOriginalReferenceV1, type CatalogOriginalRootV1,
} from './media-catalog-original-schema.ts';

export const throwIfCatalogCustodyAborted = createAbortGuard('Catalog original custody was cancelled.');

export async function hasCatalogOriginalRoot(store: IDBObjectStore, assetId: string): Promise<boolean> {
	return (await readCursorPage(store.index(CATALOG_ORIGINAL_ASSET_INDEX_NAME), { query: assetId, limit: 1 })).length > 0;
}

export async function assertNoCatalogOriginalRoot(store: IDBObjectStore, assetId?: string): Promise<void> {
	const retained = assetId === undefined
		? (await readCursorPage(store, { limit: 1 })).length > 0
		: await hasCatalogOriginalRoot(store, assetId);
	if (retained) throw new Error(`Media ${assetId ?? 'storage'} is retained by a catalog original root.`);
}

export function catalogOriginalCount(record: StorageRecord): number {
	const count = record[CATALOG_ORIGINAL_COUNT_FIELD];
	return Number.isSafeInteger(count) && Number(count) > 0 ? Number(count) : 0;
}

export async function makeCatalogOriginalRoot(
	mediaAssets: IDBObjectStore, catalogId: string, importId: string | null, reference: CatalogOriginalReferenceV1,
): Promise<Readonly<CatalogOriginalRootV1>> {
	const media = await readMediaAsset(mediaAssets, reference.assetId);
	return rootForMedia(media, catalogId, importId, reference);
}

function rootForMedia(media: StorageRecord | null, catalogId: string, importId: string | null, reference: CatalogOriginalReferenceV1): Readonly<CatalogOriginalRootV1> {
	if (!media || !trustedMediaContentSha256(media)) throw new Error('A catalog original requires verified durable media.');
	if (media.sourceId !== reference.assetId || media.size !== reference.size || media.sha256 !== reference.sha256) {
		throw new Error('Catalog original media identity does not match its verified asset.');
	}
	return normalizeCatalogOriginalRoot({
		...reference, schemaVersion: 1, key: catalogOriginalKey(catalogId, importId, reference.photoId),
		catalogId, importId, scope: catalogOriginalScope(catalogId, importId), mediaContentToken: media.mediaContentToken,
	});
}

/** The transaction exclusively owns these asset rows. Cache only within this
 * bounded batch, validate every reference and root, then flush each asset once. */
export async function retainCatalogOriginalRoots(
	stores: Readonly<Record<string, IDBObjectStore>>, catalogId: string, importId: string | null,
	references: readonly CatalogOriginalReferenceV1[], signal?: AbortSignal,
): Promise<void> {
	const mediaByAsset = new Map<string, StorageRecord | null>(), counts = new Map<string, StorageRecord>();
	const roots = stores[CATALOG_ORIGINAL_ROOT_STORE_NAME];
	for (const reference of references) {
		throwIfCatalogCustodyAborted(signal);
		let media = mediaByAsset.get(reference.assetId);
		if (media === undefined) {
			const value: unknown = await retainRequest(stores.mediaAssets.get(reference.assetId), signal);
			throwIfCatalogCustodyAborted(signal);
			media = value && typeof value === 'object' ? value as StorageRecord : null;
			mediaByAsset.set(reference.assetId, media);
		}
		const root = rootForMedia(media, catalogId, importId, reference);
		const previous: unknown = await retainRequest(roots.get(root.key), signal);
		throwIfCatalogCustodyAborted(signal);
		if (previous !== undefined) {
			if (JSON.stringify(normalizeCatalogOriginalRoot(previous)) !== JSON.stringify(root)) throw new Error('A catalog original root is immutable.');
			continue;
		}
		await retainRequest(roots.put(root), signal);
		throwIfCatalogCustodyAborted(signal);
		// Keep count validation at this reference, before a later bad reference
		// could obscure corrupt or overflowing existing count state.
		const counted = counts.get(root.assetId) ?? media;
		counts.set(root.assetId, { ...counted, [CATALOG_ORIGINAL_COUNT_FIELD]: nextCount(counted, root, 1) });
	}
	for (const media of counts.values()) {
		throwIfCatalogCustodyAborted(signal);
		await retainRequest(stores.mediaAssets.put(media), signal);
		throwIfCatalogCustodyAborted(signal);
	}
}

/** Classify cancellation at request settlement. A failure already observed
 * before a later abort stays the primary failure; no outer catch replaces it. */
function retainRequest<Result>(idbRequest: IDBRequest<Result>, signal?: AbortSignal): Promise<Result> {
	return new Promise((resolve, reject) => {
		idbRequest.onsuccess = () => {
			try { throwIfCatalogCustodyAborted(signal); resolve(idbRequest.result); } catch (error) { reject(error); }
		};
		idbRequest.onerror = () => {
			try { throwIfCatalogCustodyAborted(signal); } catch (error) { reject(error); return; }
			reject(idbRequest.error || new Error('An IndexedDB request failed.'));
		};
	});
}

export async function putCatalogOriginalRoot(stores: Readonly<Record<string, IDBObjectStore>>, root: CatalogOriginalRootV1): Promise<void> {
	const roots = stores[CATALOG_ORIGINAL_ROOT_STORE_NAME];
	const previous = await request(roots.get(root.key)) as unknown;
	if (previous !== undefined) {
		if (JSON.stringify(normalizeCatalogOriginalRoot(previous)) !== JSON.stringify(root)) {
			throw new Error('A catalog original root is immutable.');
		}
		return;
	}
	await request(roots.put(root));
	await changeCount(stores.mediaAssets, root, 1);
}

export async function deleteCatalogOriginalRoot(stores: Readonly<Record<string, IDBObjectStore>>, key: string): Promise<void> {
	const roots = stores[CATALOG_ORIGINAL_ROOT_STORE_NAME];
	const value = await request(roots.get(key)) as unknown;
	if (value === undefined) return;
	const root = normalizeCatalogOriginalRoot(value);
	await request(roots.delete(key));
	await changeCount(stores.mediaAssets, root, -1);
}

export async function catalogCustodyTransaction<Result>(
	database: IDBDatabase, operation: (stores: Readonly<Record<string, IDBObjectStore>>) => Promise<Result>, signal?: AbortSignal,
): Promise<Result> {
	throwIfCatalogCustodyAborted(signal);
	let abort: (() => void) | undefined;
	try {
		return await transact(database, ['mediaAssets', CATALOG_ORIGINAL_ROOT_STORE_NAME], 'readwrite', async (stores, transaction) => {
			abort = (): void => { try { transaction.abort(); } catch { /* Commit already settled. */ } };
			signal?.addEventListener('abort', abort, { once: true });
			throwIfCatalogCustodyAborted(signal);
			return await operation(stores);
		});
	} finally { if (abort) signal?.removeEventListener('abort', abort); }
}

async function readMediaAsset(store: IDBObjectStore, key: string): Promise<StorageRecord | null> {
	const value: unknown = await request(store.get(key));
	return value && typeof value === 'object' ? value as StorageRecord : null;
}

async function changeCount(store: IDBObjectStore, root: CatalogOriginalRootV1, delta: number): Promise<void> {
	const media = await readMediaAsset(store, root.assetId);
	const next = nextCount(media, root, delta);
	await request(store.put({ ...media, [CATALOG_ORIGINAL_COUNT_FIELD]: next }));
}

function nextCount(media: StorageRecord | null, root: CatalogOriginalRootV1, delta: number): number {
	if (!media || media.mediaContentToken !== root.mediaContentToken
		|| trustedMediaContentSha256(media) !== root.sha256 || media.size !== root.size) {
		throw new Error('Retained catalog original media identity changed.');
	}
	const previous = media[CATALOG_ORIGINAL_COUNT_FIELD] ?? 0;
	if (!Number.isSafeInteger(previous) || Number(previous) < 0) throw new Error('Catalog retention count is corrupt.');
	const next = Math.max(0, Number(previous) + delta);
	if (!Number.isSafeInteger(next)) throw new Error('Catalog retention count exceeds its safe integer budget.');
	return next;
}
