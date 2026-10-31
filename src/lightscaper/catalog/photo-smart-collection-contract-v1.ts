/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_SMART_COLLECTION_LIMITS_V1, photoSmartCollectionSummaryV1, readPhotoSmartCollectionSummaryV1,
	type PhotoSmartCollectionV1, type PhotoSmartCollectionSummaryV1 } from './photo-smart-collection-v1.ts';
import { photoSmartCollectionKeyV1 } from './photo-smart-collection-record-v1.ts';
import { readPhotoSmartCollectionSignalOptionsV1 } from './photo-smart-collection-repository-types-v1.ts';
import type { PhotoSmartCollectionsStateV1 } from './photo-smart-collection-state-v1.ts';
import type { PhotoCatalogRootV1 } from './types.ts';
import type { PhotoCatalogIndexStateV1 } from './repository-types.ts';
import { field, id, record } from './value-validation.ts';

export const PHOTO_SMART_COLLECTION_AUDIT_LIMITS_V1 = Object.freeze({ maximumPageBytes: 8_388_608,
	maximumDefinitions: 10, maximumKeys: 64, reservedScalarBytes: 524_288 });
export interface PhotoSmartCollectionStorageContextV1 {
	readonly root: PhotoCatalogRootV1;
	readonly index: PhotoCatalogIndexStateV1;
	readonly state: PhotoSmartCollectionsStateV1;
}
export interface PhotoSmartCollectionSummaryRecordV1 {
	readonly key: string;
	readonly catalogId: string;
	readonly document: Readonly<PhotoSmartCollectionSummaryV1>;
}
export function photoSmartCollectionSummaryRecordV1(value: unknown): Readonly<PhotoSmartCollectionSummaryRecordV1> {
	const document = photoSmartCollectionSummaryV1(value);
	const row = Object.freeze({ key: photoSmartCollectionKeyV1(document.catalogId, document.id), catalogId: document.catalogId, document });
	checkSummaryBudget(row); return row;
}

export function readPhotoSmartCollectionSummaryRecordV1(value: unknown, catalogId: string, key: IDBValidKey): Readonly<PhotoSmartCollectionSummaryV1> {
	const catalog = id(catalogId, 'summary lookup catalog ID');
	const input = record(value, 'stored smart collection summary', ['key', 'catalogId', 'document']);
	const document = readPhotoSmartCollectionSummaryV1(field(input, 'document'));
	const expectedKey = photoSmartCollectionKeyV1(catalog, document.id);
	if (document.catalogId !== catalog || field(input, 'catalogId') !== catalog || field(input, 'key') !== key
		|| key !== expectedKey) throw new TypeError('Stored collection summary identity disagrees with its key.');
	checkSummaryBudget({ key: expectedKey, catalogId: catalog, document });
	return document;
}

function checkSummaryBudget(value: PhotoSmartCollectionSummaryRecordV1): void {
	if (new TextEncoder().encode(JSON.stringify(value)).byteLength > PHOTO_SMART_COLLECTION_LIMITS_V1.maximumSummaryBytes) {
		throw new RangeError('Stored smart collection summary exceeds its 4096 byte budget.');
	}
}

export interface PhotoSmartCollectionSnapshotContextV1 {
	readonly catalogId: string;
	readonly catalogRevision: number;
	readonly indexRevision: number;
	readonly collectionStateRevision: number;
	readonly collectionCount: number;
}
export interface PhotoSmartCollectionSnapshotV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-smart-collection-snapshot';
	readonly selectedId: string | null;
	readonly context: PhotoSmartCollectionSnapshotContextV1;
	readonly definition: Readonly<PhotoSmartCollectionV1> | null;
}

/** Closed scalar selection and intrinsic cancellation detach before lazy database acquisition. */
export function admitPhotoSmartCollectionSnapshotRequestV1(catalogValue: unknown, selectedValue: unknown, value: unknown = {}) {
	const catalogId = id(catalogValue, 'saved snapshot catalog ID');
	const selectedId = selectedValue === null ? null : id(selectedValue, 'saved snapshot selection ID');
	return Object.freeze({ catalogId, selectedId, ...readPhotoSmartCollectionSignalOptionsV1(value) });
}

export interface PhotoSmartCollectionArchiveContextV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-smart-collection-archive-context';
	readonly catalogId: string;
	readonly catalogRevision: number;
	readonly indexRevision: number;
	/** Physical absence differs from a persisted empty state, including revision zero. */
	readonly state: Readonly<PhotoSmartCollectionsStateV1> | null;
}

/** Closed scalar admission completes before a repository opens its lazy database. */
export function admitPhotoSmartCollectionArchiveContextRequestV1(catalogValue: unknown, options: unknown = {}) {
	return Object.freeze({ catalogId: id(catalogValue, 'archive saved collection catalog ID'),
		...readPhotoSmartCollectionSignalOptionsV1(options) });
}

export interface PhotoSmartCollectionArchiveCaptureV1 {
	readonly context: PhotoSmartCollectionArchiveContextV1;
	readonly definitions: AsyncIterable<PhotoSmartCollectionV1>;
	/** Complete final inventory authentication must precede the destination's finish. */
	readonly verify: () => Promise<void>;
}
/** Query2 defaults are useful for transient callers, but cannot repair an incomplete archived recipe. */
export function assertPhotoSmartCollectionArchiveQueryV1(_document: PhotoSmartCollectionV1, raw: unknown): void {
	const input = record(raw, 'archive saved collection record', ['key', 'catalogId', 'referenceKeys', 'document']);
	const definition = record(field(input, 'document'), 'archive saved collection definition',
		['schemaVersion', 'kind', 'catalogId', 'id', 'name', 'revision', 'query']);
	record(field(definition, 'query'), 'complete archive saved Query2', ['schemaVersion', 'kind', 'text', 'filter', 'sort', 'predicate']);
}
