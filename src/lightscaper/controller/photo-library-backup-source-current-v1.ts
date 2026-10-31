/* SPDX-License-Identifier: AGPL-3.0-only */

import { capturePhotoLibraryBackupOriginalSourceCurrentV1, yieldPhotoLibraryBackupOriginalCurrentV1 } from './photo-library-backup-original-source-current-v1.ts';
import type { PhotoLibraryOriginalSourceCurrentV1 } from './photo-library-original-source-current-v1.ts';
import type { PhotoCatalogPackInputV4 } from '../archive/catalog-pack-v4.ts';
import type { PhotoCatalogPackInputCurrentV1 } from '../archive/catalog-pack-current-v1.ts';
import type { PhotoCatalogPackInputV2 } from '../archive/catalog-pack-v2.ts';
import type { PhotoOriginalV1 } from '../catalog/types.ts';
import type { PhotoResourceReferencesCurrentV1 } from '../catalog/photo-resource-reachability-current-v1.ts';
import type { PhotoCatalogSnapshotV1 } from '../catalog/repository-snapshot.ts';
import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import { normalizePhotoDocumentThroughV3 } from '../catalog/photo-document-through-v3.ts';
import { id } from '../catalog/value-validation.ts';
import { capturePhotoLibraryBackupMetadataPreflightCurrentV1 } from './photo-library-backup-metadata-preflight-current-v1.ts';
import type { PhotoLibraryBackupMetadataCatalogCurrentV1 } from './photo-library-backup-metadata-walk-current-v1.ts';

export interface PhotoLibraryBackupSourcePortsCurrentV1 {
	readonly catalog: PhotoLibraryBackupMetadataCatalogCurrentV1;
	readonly loadOriginal?: (original: PhotoOriginalV1, signal?: AbortSignal) => Promise<unknown>;
	readonly originalSource?: PhotoLibraryOriginalSourceCurrentV1;
}
interface Scalars {
	readonly initial: PhotoCatalogSnapshotV1;
	readonly references: Readonly<PhotoResourceReferencesCurrentV1>;
	readonly verifyCatalog: () => Promise<void>;
	readonly photoPackCount: number;
}
export type PhotoLibraryBackupSourceCurrentV1 = Scalars & (
	| Readonly<{ requiresCurrentFormat: true; requiresRawDevelopment: true; originals: AsyncIterable<PhotoCatalogPackInputCurrentV1> }>
	| Readonly<{ requiresCurrentFormat: true; requiresRawDevelopment: false; originals: AsyncIterable<PhotoCatalogPackInputV4> }>
	| Readonly<{ requiresCurrentFormat: false; requiresRawDevelopment: false; originals: AsyncIterable<PhotoCatalogPackInputV2> }>);
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }

/** Fresh whole metadata precedes each lazy Original read; no document/body
 * cache is retained. Legacy fallback re-admits the genuine whole legacy value. */
export async function capturePhotoLibraryBackupSourceCurrentV1(catalogValue: unknown, ports: PhotoLibraryBackupSourcePortsCurrentV1,
	row: unknown | null, signal?: AbortSignal): Promise<Readonly<PhotoLibraryBackupSourceCurrentV1>> {
	check(signal); const catalogId = id(catalogValue, 'backup catalog ID'), catalog = ports.catalog;
	const originalSource = capturePhotoLibraryBackupOriginalSourceCurrentV1(ports);
	const metadata = await capturePhotoLibraryBackupMetadataPreflightCurrentV1(catalogId, catalog, row, signal); check(signal);
	const scalars = { initial: metadata.initial, references: metadata.references, verifyCatalog: metadata.verifyCatalog, photoPackCount: metadata.photoPackCount };
	if (metadata.requiresRawDevelopment) return Object.freeze({ ...scalars, requiresCurrentFormat: true, requiresRawDevelopment: true, originals: rawOriginals() });
	return metadata.requiresCurrentFormat ? Object.freeze({ ...scalars, requiresCurrentFormat: true, requiresRawDevelopment: false, originals: currentOriginals() })
		: Object.freeze({ ...scalars, requiresCurrentFormat: false, requiresRawDevelopment: false, originals: legacyOriginals() });

	async function* rawOriginals(): AsyncGenerator<PhotoCatalogPackInputCurrentV1> {
		for await (const photo of metadata.photos()) yield* yieldPhotoLibraryBackupOriginalCurrentV1(photo, originalSource, signal);
	}
	async function* currentOriginals(): AsyncGenerator<PhotoCatalogPackInputV4> {
		for await (const value of metadata.photos()) {
			const photo = normalizePhotoDocumentThroughV3(value);
			yield* yieldPhotoLibraryBackupOriginalCurrentV1(photo, originalSource, signal);
		}
	}
	async function* legacyOriginals(): AsyncGenerator<PhotoCatalogPackInputV2> {
		for await (const value of metadata.photos()) {
			const photo = normalizePhotoDocumentV1OrV2(value); check(signal);
			yield* yieldPhotoLibraryBackupOriginalCurrentV1(photo, originalSource, signal);
		}
	}
}
