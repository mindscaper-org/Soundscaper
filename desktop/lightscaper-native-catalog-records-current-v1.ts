/* SPDX-License-Identifier: AGPL-3.0-only */

import { readValidatedPhotoCatalogRootV1 } from '../src/lightscaper/catalog/documents.ts';
import { parsePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { canonicalPhotoDocumentJsonV1 } from '../src/lightscaper/catalog/photo-document-json-v1.ts';
import { indexState, photoStorageKey, photoSummary, readPhotoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { PHOTO_CATALOG_REPOSITORY_LIMITS, type PhotoCatalogIndexStateV1, type PhotoSummaryV1 } from '../src/lightscaper/catalog/repository-types.ts';
import { LIGHTSCAPER_CATALOG_LIMITS, type PhotoCatalogRootV1 } from '../src/lightscaper/catalog/types.ts';
import { field, id, integer, record } from '../src/lightscaper/catalog/value-validation.ts';

export interface LightscaperNativeCatalogSnapshotCurrentV1 {
	readonly root: Readonly<PhotoCatalogRootV1>;
	readonly index: Readonly<PhotoCatalogIndexStateV1>;
}

/** One native row binds the exact V1 root and its independently advancing index
 * epoch. No second read or renderer shadow state can splice those revisions. */
export function readLightscaperNativeCatalogRowCurrentV1(value: unknown, expectedId?: string): Readonly<LightscaperNativeCatalogSnapshotCurrentV1> {
	const input = record(value, 'native catalog row', ['id', 'document', 'root_revision', 'photo_count', 'index_revision']);
	const catalogId = id(field(input, 'id'), 'native catalog ID');
	if (expectedId !== undefined && catalogId !== id(expectedId, 'requested catalog ID')) throw new TypeError('Native catalog belongs to another requested identity.');
	const root = readValidatedPhotoCatalogRootV1(parse(field(input, 'document'), LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes));
	if (root.id !== catalogId || root.revision !== field(input, 'root_revision') || root.photoCount !== field(input, 'photo_count')) {
		throw new TypeError('Native catalog document disagrees with its stored identity, revision or count.');
	}
	const index = indexState(root, integer(field(input, 'index_revision'), 0, Number.MAX_SAFE_INTEGER, 'native index revision'));
	return Object.freeze({ root, index });
}

/** Whole Current1/2/3 admission stays with Photo's owning parser. Reading never
 * promotes a version and verifies that its scalar summary is its projection. */
export function readLightscaperNativePhotoRowCurrentV1(value: unknown, expectedCatalogId?: string, expectedPhotoId?: string): Readonly<PhotoDocumentCurrentV1> {
	const input = record(value, 'native photo row', ['photo_key', 'catalog_id', 'photo_id', 'revision', 'document', 'summary']);
	const text = boundedText(field(input, 'document'), LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes);
	const photo = parsePhotoDocumentCurrentV1(text);
	const summary = readLightscaperNativeSummaryRowCurrentV1({ photo_key: field(input, 'photo_key'), catalog_id: field(input, 'catalog_id'),
		photo_id: field(input, 'photo_id'), revision: field(input, 'revision'), summary: field(input, 'summary') }, expectedCatalogId);
	if (photo.catalogId !== summary.catalogId || photo.id !== summary.photoId || photo.revision !== summary.photoRevision
		|| (expectedPhotoId !== undefined && photo.id !== id(expectedPhotoId, 'requested photo ID'))
		|| canonicalPhotoDocumentJsonV1(photoSummary(photo)) !== canonicalPhotoDocumentJsonV1(summary)) {
		throw new TypeError('Native photo document disagrees with its exact key, revision or summary projection.');
	}
	return photo;
}

/** Bounded catalog pages select only these five fields. This deliberately
 * neither selects nor parses potentially large Photo/Develop aggregates. */
export function readLightscaperNativeSummaryRowCurrentV1(value: unknown, expectedCatalogId?: string): Readonly<PhotoSummaryV1> {
	const input = record(value, 'native summary row', ['photo_key', 'catalog_id', 'photo_id', 'revision', 'summary']);
	const catalogId = id(field(input, 'catalog_id'), 'native summary catalog ID'), photoId = id(field(input, 'photo_id'), 'native summary photo ID');
	const key = photoStorageKey(catalogId, photoId), revision = integer(field(input, 'revision'), 0, Number.MAX_SAFE_INTEGER, 'native photo revision');
	if (field(input, 'photo_key') !== key || (expectedCatalogId !== undefined && catalogId !== id(expectedCatalogId, 'requested catalog ID'))) {
		throw new TypeError('Native summary key disagrees with its requested identity.');
	}
	const summary = readPhotoSummary(parse(field(input, 'summary'), PHOTO_CATALOG_REPOSITORY_LIMITS.maximumSummaryBytes));
	if (summary.key !== key || summary.catalogId !== catalogId || summary.photoId !== photoId || summary.photoRevision !== revision) {
		throw new TypeError('Native summary projection disagrees with its scalar identity or revision.');
	}
	return summary;
}

function parse(value: unknown, maximumBytes: number): unknown { return JSON.parse(boundedText(value, maximumBytes)) as unknown; }
function boundedText(value: unknown, maximumBytes: number): string {
	if (typeof value !== 'string') throw new TypeError('Native Photo record requires JSON text.');
	if (value.length > maximumBytes || Buffer.byteLength(value, 'utf8') > maximumBytes) throw new RangeError('Native Photo record exceeds its byte budget.');
	return value;
}
