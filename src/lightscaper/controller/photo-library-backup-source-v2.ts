/* SPDX-License-Identifier: AGPL-3.0-only */

import { capturePhotoLibraryBackupOriginalSourceCurrentV1, yieldPhotoLibraryBackupOriginalCurrentV1 } from './photo-library-backup-original-source-current-v1.ts';
import type { PhotoLibraryOriginalSourceCurrentV1 } from './photo-library-original-source-current-v1.ts';
import type { PhotoCatalogPackInputV2 } from '../archive/catalog-pack-v2.ts';
import type { PhotoCatalogSnapshotV1 } from '../catalog/repository-snapshot.ts';
import type { PhotoOriginalV1 } from '../catalog/types.ts';
import { id } from '../catalog/value-validation.ts';
import { capturePhotoLibraryBackupMetadataPreflightV1, type PhotoLibraryBackupMetadataCatalogV1 } from './photo-library-backup-metadata-preflight-v1.ts';

export interface PhotoLibraryBackupSourcePortsV2 {
	readonly catalog: PhotoLibraryBackupMetadataCatalogV1;
	readonly loadOriginal?: (original: PhotoOriginalV1, signal?: AbortSignal) => Promise<unknown>;
	readonly originalSource?: PhotoLibraryOriginalSourceCurrentV1;
}
export interface PhotoLibraryBackupSourceV2 {
	readonly initial: PhotoCatalogSnapshotV1;
	readonly originals: AsyncIterable<PhotoCatalogPackInputV2>;
	readonly verifyCatalog: () => Promise<void>;
}

/** Complete metadata preflight borrows existing repositories and opens no
 * original/resource body or writer. Original bodies stay lazy and serial. */
export async function capturePhotoLibraryBackupSourceV2(catalogValue: unknown, ports: PhotoLibraryBackupSourcePortsV2,
	signal?: AbortSignal): Promise<PhotoLibraryBackupSourceV2> {
	const catalogId = id(catalogValue, 'backup catalog ID'); check(signal);
	const catalog = ports.catalog, originalSource = capturePhotoLibraryBackupOriginalSourceCurrentV1(ports);
	const metadata = await capturePhotoLibraryBackupMetadataPreflightV1(catalogId, catalog, signal); check(signal);
	return Object.freeze({ initial: metadata.initial, originals: originals(), verifyCatalog: metadata.verifyCatalog });

	async function* originals(): AsyncGenerator<PhotoCatalogPackInputV2> {
		for await (const photo of metadata.photos()) {
			check(signal);
			yield* yieldPhotoLibraryBackupOriginalCurrentV1(photo, originalSource, signal);
		}
	}
}

const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
