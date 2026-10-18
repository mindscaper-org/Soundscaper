/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { assertNotAborted } from './catalog-transaction.ts';
import { validateLightscaperDocumentV1 } from './documents.ts';
import { readIndexState } from './repository-records.ts';
import { normalizePhotoSmartCollectionsStateV1 } from './photo-smart-collection-state-v1.ts';
import { photoSmartCollectionKeyV1 } from './photo-smart-collection-record-v1.ts';
import { PHOTO_SMART_COLLECTION_LIMITS_V1 } from './photo-smart-collection-v1.ts';
import { array, id } from './value-validation.ts';

import type { PhotoSmartCollectionStorageContextV1 } from './photo-smart-collection-contract-v1.ts';
export { photoSmartCollectionSummaryRecordV1, readPhotoSmartCollectionSummaryRecordV1 } from './photo-smart-collection-contract-v1.ts';
export type { PhotoSmartCollectionStorageContextV1, PhotoSmartCollectionSummaryRecordV1 } from './photo-smart-collection-contract-v1.ts';

export const PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1 = Object.freeze(['catalogs', 'catalogStates', 'photoSmartCollections',
	'photoSmartCollectionSummaries', 'photoSmartCollectionStates'] as const);
/** Point admission only. An explicit bounded audit must authenticate exact counts before repository publication. */
export async function readPhotoSmartCollectionStorageContextV1(stores: Readonly<Record<string, IDBObjectStore>>, catalogId: string, signal?: AbortSignal): Promise<PhotoSmartCollectionStorageContextV1> {
	const catalog = id(catalogId, 'smart collection catalog ID');
	assertNotAborted(signal);
	async function read(operation: IDBRequest): Promise<unknown> {
		const value: unknown = await request(operation); assertNotAborted(signal); return value;
	}
	const raw = await read(stores.catalogs.get(catalog));
	if (raw === undefined) throw new ReferenceError('Photo catalog is missing.');
	const root = validateLightscaperDocumentV1(raw);
	if (root.kind !== 'photo-catalog' || root.id !== catalog) throw new TypeError('Smart collection catalog identity disagrees with its key.');
	const index = readIndexState(await read(stores.catalogStates.get(catalog)));
	if (index.id !== catalog || index.rootRevision !== root.revision || index.photoCount !== root.photoCount) {
		throw new TypeError('Catalog index disagrees with root.');
	}
	const stateRaw = await read(stores.photoSmartCollectionStates.get(catalog));
	const state = normalizePhotoSmartCollectionsStateV1(stateRaw === undefined
		? { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: catalog, revision: 0, collectionCount: 0 } : stateRaw);
	if (state.catalogId !== catalog) throw new TypeError('Smart collections state belongs to another catalog.');
	if (root.collections.length + state.collectionCount > PHOTO_SMART_COLLECTION_LIMITS_V1.maximumCollections) {
		throw new RangeError('Combined catalog collection count exceeds its 10000 collection budget.');
	}
	const definitionKey = scopedKey(await read(stores.photoSmartCollections.index('catalogId').getKey(catalog)), catalog);
	const summaryKey = scopedKey(await read(stores.photoSmartCollectionSummaries.index('catalogId').getKey(catalog)), catalog);
	if (state.collectionCount === 0) {
		if (definitionKey !== null || summaryKey !== null) throw new TypeError('Empty or missing smart collection state has retained rows.');
	} else if (definitionKey === null || summaryKey === null || definitionKey !== summaryKey) {
		throw new TypeError('Positive smart collection state has missing or unpaired rows.');
	}
	return Object.freeze({ root, index, state });
}

function scopedKey(value: unknown, catalogId: string): string | null {
	if (value === undefined) return null;
	if (typeof value !== 'string' || value.length > 263) throw new TypeError('Stored smart collection key must be a bounded JSON tuple.');
	const tuple: unknown = JSON.parse(value);
	const parts = array(tuple, 'smart collection key', 2, 2);
	if (parts[0] !== catalogId || value !== photoSmartCollectionKeyV1(catalogId, id(parts[1], 'stored collection ID'))) {
		throw new TypeError('Stored smart collection key belongs to another catalog or is not canonical.');
	}
	return value;
}
