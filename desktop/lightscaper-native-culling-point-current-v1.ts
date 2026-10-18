/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { readLightscaperNativePhotoRowCurrentV1 } from './lightscaper-native-catalog-records-current-v1.ts';
import { getLightscaperNativeLegacyQueryBuildCurrentV1 } from './lightscaper-native-legacy-query-write-current-v1.ts';
import { getLightscaperNativeQueryBuildCurrentV1 } from './lightscaper-native-query-write-current-v1.ts';
import { readLightscaperNativeLegacyQueryRowCurrentV1 } from './lightscaper-native-legacy-query-records-current-v1.ts';
import { readLightscaperNativeQueryRowCurrentV1 } from './lightscaper-native-query-records-current-v1.ts';
import { photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { photoQueryMatcherV1 } from '../src/lightscaper/catalog/photo-query-matcher-v1.ts';
import { photoQueryMatcherV2 } from '../src/lightscaper/catalog/photo-query-matcher-v2.ts';
import { photoQueryRowKeyV1, projectPhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-contract-v1.ts';
import { photoQueryRowKeyV2, projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { PhotoQueryIndexNotReadyError } from '../src/lightscaper/catalog/photo-query-errors.ts';
import type { PhotoCatalogQueryV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import type { PhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import type { PhotoQueryInclusivePosition } from '../src/lightscaper/catalog/photo-query-position.ts';
import type { PhotoCatalogRootV1 } from '../src/lightscaper/catalog/types.ts';
import type { PhotoSummaryV1 } from '../src/lightscaper/catalog/repository-types.ts';

export type LightscaperNativeCullingQueryCurrentV1 = PhotoCatalogQueryV1 | PhotoCatalogQueryV2;
export interface LightscaperNativeCullingPointCurrentV1 {
	readonly summary: PhotoSummaryV1;
	readonly position: PhotoQueryInclusivePosition | null;
}
const QUERY_COLUMNS = 'photo_key,catalog_id,photo_id,photo_revision,row_json,file_name_key,capture_bucket,capture_sort,rating_sort';
const nativeCheck = AbortSignal.prototype.throwIfAborted;

/** The selected whole Current and duplicate projected row live only within
 * this bounded point call, never through later traversal or a phase yield.
 * Matcher/reference and ready-build refusal precede missing selected/null. */
export function readLightscaperNativeCullingPointCurrentV1(database: DatabaseSync, root: Readonly<PhotoCatalogRootV1>, photoId: string,
	query: LightscaperNativeCullingQueryCurrentV1 | null, signal?: AbortSignal): LightscaperNativeCullingPointCurrentV1 | null {
	if (!database.isTransaction) throw new Error('Native culling point requires its caller snapshot.'); check(signal);
	const metadata = query !== null && 'schemaVersion' in query;
	const matches = query === null ? null : metadata ? photoQueryMatcherV2(root, query as PhotoCatalogQueryV2) : photoQueryMatcherV1(root, query);
	if (query !== null) {
		const build = metadata ? getLightscaperNativeQueryBuildCurrentV1(database, root.id) : getLightscaperNativeLegacyQueryBuildCurrentV1(database, root.id);
		if (!build?.ready) throw new PhotoQueryIndexNotReadyError();
		if (build.indexedCount !== root.photoCount) throw new TypeError('Ready culling index count disagrees with its catalog.');
	}
	check(signal); const key = photoStorageKey(root.id, photoId);
	const raw = database.prepare('SELECT photo_key,catalog_id,photo_id,revision,document,summary FROM native_photos WHERE photo_key=?').get(key);
	if (raw === undefined) return null;
	const photo = readLightscaperNativePhotoRowCurrentV1(raw, root.id, photoId), summary = photoSummary(photo); check(signal);
	if (query === null) return Object.freeze({ summary, position: null });
	if (metadata) {
		const row = readLightscaperNativeQueryRowCurrentV1(database.prepare(`SELECT ${QUERY_COLUMNS} FROM native_photo_query_rows_v2 WHERE photo_key=?`).get(key));
		if (JSON.stringify(row) !== JSON.stringify(projectPhotoQueryRowV2(photo))) throw new TypeError('Culling point row differs from its current Photo.');
		if (!(matches as ReturnType<typeof photoQueryMatcherV2>)(row)) return null;
		return Object.freeze({ summary, position: Object.freeze({ captureBucket: query.sort.field === 'capture-time' ? row.captureBucket : 0 as const,
			key: Object.freeze(photoQueryRowKeyV2(row, query.sort.field)) }) });
	}
	const row = readLightscaperNativeLegacyQueryRowCurrentV1(database.prepare(`SELECT ${QUERY_COLUMNS} FROM native_photo_query_rows_v1 WHERE photo_key=?`).get(key));
	if (JSON.stringify(row) !== JSON.stringify(projectPhotoQueryRowV1(photo))) throw new TypeError('Culling point row differs from its current Photo.');
	if (!(matches as ReturnType<typeof photoQueryMatcherV1>)(row)) return null;
	return Object.freeze({ summary, position: Object.freeze({ captureBucket: query.sort.field === 'capture-time' ? row.captureBucket : 0 as const,
		key: Object.freeze(photoQueryRowKeyV1(row, query.sort.field)) }) });
}
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(nativeCheck, signal, []); }
