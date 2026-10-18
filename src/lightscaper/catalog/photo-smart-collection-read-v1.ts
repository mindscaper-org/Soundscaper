/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { assertNotAborted } from './catalog-transaction.ts';
import { readPhotoSmartCollectionRecordV1 } from './photo-smart-collection-record-v1.ts';
import { readPhotoSmartCollectionSummaryRecordV1 } from './photo-smart-collection-storage-v1.ts';
import type { PhotoSmartCollectionV1 } from './photo-smart-collection-v1.ts';

export { validatePhotoSmartCollectionReferencesV1 } from './photo-smart-collection-references-v1.ts';

/** One exact definition/summary pair; absence is genuine only when both are absent. */
export async function readPhotoSmartCollectionDefinitionV1(stores: Readonly<Record<string, IDBObjectStore>>, catalogId: string,
	key: string, signal?: AbortSignal): Promise<Readonly<PhotoSmartCollectionV1> | null> {
	const raw: unknown = await request(stores.photoSmartCollections.get(key)); assertNotAborted(signal);
	const rawSummary: unknown = await request(stores.photoSmartCollectionSummaries.get(key)); assertNotAborted(signal);
	if (raw === undefined && rawSummary === undefined) return null;
	if (raw === undefined || rawSummary === undefined) throw new TypeError('Saved collection has an orphan definition or missing summary.');
	const definition = readPhotoSmartCollectionRecordV1(raw, catalogId, key), summary = readPhotoSmartCollectionSummaryRecordV1(rawSummary, catalogId, key);
	if (summary.name !== definition.name || summary.revision !== definition.revision) throw new TypeError('Saved collection summary disagrees with its definition.');
	return definition;
}
