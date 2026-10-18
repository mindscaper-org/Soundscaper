/* SPDX-License-Identifier: AGPL-3.0-only */

import { capturePhotoLibraryBackupOriginalSourceCurrentV1, yieldPhotoLibraryBackupOriginalCurrentV1 } from './photo-library-backup-original-source-current-v1.ts';
import type { BrushMaskResourceReferenceV1 } from '../../common/editor/imaging/brush-mask-resource-v1.ts';
import type { PhotoCatalogPackInputV2 } from '../archive/catalog-pack-v2.ts';
import { id } from '../catalog/value-validation.ts';
import { capturePhotoLibraryBackupMetadataPreflightV2 } from './photo-library-backup-metadata-preflight-v2.ts';
import type { PhotoLibraryBackupSourcePortsV2, PhotoLibraryBackupSourceV2 } from './photo-library-backup-source-v2.ts';

export interface PhotoLibraryBackupSourceV3 extends PhotoLibraryBackupSourceV2 {
	readonly references: readonly Readonly<BrushMaskResourceReferenceV1>[];
}
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }

/** Mixed-resource metadata admission is complete before lazy originals.
 * Original capability/receiver is pinned before the first metadata read. */
export async function capturePhotoLibraryBackupSourceV3(catalogValue: unknown, ports: PhotoLibraryBackupSourcePortsV2,
	signal?: AbortSignal): Promise<Readonly<PhotoLibraryBackupSourceV3>> {
	const catalogId = id(catalogValue, 'backup catalog ID'); check(signal);
	const catalog = ports.catalog, originalSource = capturePhotoLibraryBackupOriginalSourceCurrentV1(ports);
	const metadata = await capturePhotoLibraryBackupMetadataPreflightV2(catalogId, catalog, signal); check(signal);
	return Object.freeze({ initial: metadata.initial, references: metadata.references,
		originals: originals(), verifyCatalog: metadata.verifyCatalog });

	async function* originals(): AsyncGenerator<PhotoCatalogPackInputV2> {
		for await (const photo of metadata.photos()) {
			check(signal);
			yield* yieldPhotoLibraryBackupOriginalCurrentV1(photo, originalSource, signal);
		}
	}
}
