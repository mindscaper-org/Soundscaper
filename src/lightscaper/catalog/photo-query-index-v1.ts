/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/media/indexeddb.ts';
import { readPhotoQueryBuildStateV1, type PhotoQueryRowV1 } from './photo-query-contract-v1.ts';

export { PHOTO_QUERY_INDEXES_V1, projectPhotoQueryRowV1, readPhotoQueryRowV1, photoQueryRowKeyV1,
	readPhotoQueryBuildStateV1, photoQueryBuildProgressV1 } from './photo-query-contract-v1.ts';
export type { PhotoQueryRowV1, PhotoQueryBuildStateV1 } from './photo-query-contract-v1.ts';
export { PhotoQueryIndexNotReadyError } from './photo-query-errors.ts';

/** Point reads and row/count writes share the caller's publication or rebuild transaction. */
export async function publishPhotoQueryRowV1(stores: Readonly<Record<string, IDBObjectStore>>, row: PhotoQueryRowV1): Promise<void> {
	const rawBuild: unknown = await request(stores.photoQueryBuildStates.get(row.catalogId));
	const build = rawBuild === undefined ? { id: row.catalogId, schemaVersion: 1 as const, ready: false, afterKey: null, indexedCount: 0 }
		: readPhotoQueryBuildStateV1(rawBuild, row.catalogId);
	const previous: unknown = await request(stores.photoQueryRows.getKey(row.key));
	if (previous !== undefined && rawBuild === undefined) throw new TypeError('Existing query rows require a consistent build state.');
	await request(stores.photoQueryRows.put(row));
	if (previous === undefined) await request(stores.photoQueryBuildStates.put(readPhotoQueryBuildStateV1({ ...build, indexedCount: build.indexedCount + 1 }, row.catalogId)));
}
