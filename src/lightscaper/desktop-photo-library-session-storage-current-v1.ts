/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DesktopPhotoLinkedLibraryPortCurrentV1 } from './desktop-photo-linked-port-current-v1.ts';
import type { PhotoLibraryRawImportSourceCurrentV1 } from './controller/photo-library-raw-import-current-v1.ts';
import type { PhotoLibraryRawSourceCurrentV1 } from './controller/photo-library-raw-source-current-v1.ts';
import type { KeyValueEntry } from '../common/editor/storage/key-value-repository.ts';
import type { BinaryDerivativeCacheProfileV1 } from '../common/editor/storage/binary-derivative-cache-records.ts';
import type { BinaryDerivativeCachePortV1 } from '../common/editor/storage/binary-derivative-cache-repository.ts';
import type { MediaAssetWriteOptions, MediaAssetWriter } from '../common/editor/storage/media-asset-write-contract.ts';
import type { MediaCatalogOriginalRepositoryV1 } from '../common/editor/storage/media-catalog-original-repository.ts';
import type { CatalogOriginalInspectionOutcomeV1 } from '../common/editor/storage/media-catalog-original-inspection-repository.ts';
import type { CatalogOriginalRepairBindingV1, CatalogOriginalRepairOptionsV1,
	CatalogOriginalRepairReceiptV1 } from '../common/editor/storage/media-catalog-original-repair-contract.ts';
import type { PhotoCatalogRepositoryCurrentV1 } from './catalog/photo-catalog-repository-current-v1.ts';
import type { PhotoCatalogImportExclusiveV1 } from './import/catalog-write-lock-v1.ts';
import type { PhotoImportIntentV1 } from './import/import-intent-v1.ts';
import type { PhotoMediaSettingsRepositoryV1 } from './storage/photo-media-store.ts';
import type { PhotoMediaCubeLutResourcesV1 } from './storage/photo-media-cube-lut-resources-v1.ts';
import type { PhotoMediaMaskRasterResourcesV1 } from './storage/photo-media-mask-raster-resources-v1.ts';
import type { DesktopPhotoOriginalTransportCurrentV1 } from './desktop-photo-original-contract-current-v1.ts';

type Catalog = Readonly<Required<Pick<PhotoCatalogRepositoryCurrentV1,
	'createCatalog' | 'loadCatalog' | 'loadPhoto' | 'publishPhotos' | 'publishDerivedPhotoCurrentV1'
	| 'savePhoto' | 'saveCatalog' | 'readSummaryPage' | 'readCullingDestinationPage' | 'readSnapshot'
	| 'readQueryPage' | 'readQueryPageV2' | 'readStackQueryPage' | 'readStackQueryPageV2'
	| 'rebuildQueryIndexPage' | 'rebuildQueryIndexPageV2' | 'loadStack' | 'readStackState'
	| 'readStackPage' | 'readStackMembershipPage' | 'readStackMemberPage' | 'saveStack' | 'dissolveStack'
	| 'loadSmartCollection' | 'readSmartCollectionState' | 'readSmartCollectionPage' | 'readSmartCollectionSnapshotV1'
	| 'saveSmartCollection' | 'deleteSmartCollection' | 'readSmartCollectionQueryPageV1'
	| 'readSmartCollectionStackQueryPageV1' | 'readSmartCollectionArchiveContextV1' | 'captureSmartCollectionArchiveV1'>>>;
type Custody = Readonly<Pick<MediaCatalogOriginalRepositoryV1,
	'retain' | 'stage' | 'release' | 'releaseStaged' | 'promote' | 'readPage' | 'findDigestPage'>>;
type Options = Readonly<{ signal?: AbortSignal }>;
type ImportPresets = Readonly<Pick<PhotoMediaSettingsRepositoryV1,
	'get' | 'readEntry' | 'putIfAbsent' | 'replaceIfCurrent'>>;

interface Media {
	readonly catalogOriginals: Custody;
	readonly findManagedOriginalDigestPageCurrentV1: Custody['findDigestPage'];
	writeAsset(sourceId: string, input: Blob, metadata?: Readonly<Record<string, unknown>>,
		options?: Options): Promise<Record<string, unknown>>;
	beginAssetWrite(sourceId: string, metadata: Readonly<Record<string, unknown>>,
		options: MediaAssetWriteOptions): Promise<MediaAssetWriter>;
	getAssetMetadata(sourceId: string): Promise<Record<string, unknown> | null>;
	deleteAsset(sourceId: string, options?: Options): Promise<void>;
	inspectCatalogOriginalBody(binding: CatalogOriginalRepairBindingV1,
		options?: CatalogOriginalRepairOptionsV1): Promise<CatalogOriginalInspectionOutcomeV1>;
	restoreCatalogOriginalBody(binding: CatalogOriginalRepairBindingV1, selected: Blob,
		options?: CatalogOriginalRepairOptionsV1): Promise<Readonly<CatalogOriginalRepairReceiptV1>>;
	createBinaryDerivativeCache(profile: BinaryDerivativeCacheProfileV1): Readonly<BinaryDerivativeCachePortV1>;
}

interface Components {
	readonly linked?: Readonly<DesktopPhotoLinkedLibraryPortCurrentV1>;
	readonly rawImport?: Readonly<PhotoLibraryRawImportSourceCurrentV1>;
	readonly raw?: Readonly<PhotoLibraryRawSourceCurrentV1>;
	readonly catalog: Catalog;
	readonly media: Readonly<Media>;
	readonly settings: Readonly<{
		settingsRepository: PhotoMediaSettingsRepositoryV1;
		readSessionDomainEntryCurrentV1(catalogId: string, domain: unknown): Promise<KeyValueEntry>;
		readImportIntentCurrentV1(catalogId: string): Promise<Readonly<PhotoImportIntentV1> | null>;
	}>;
	readonly resources: Readonly<{
		cubeLutResources(): Promise<Readonly<Required<PhotoMediaCubeLutResourcesV1>>>;
		maskRasterResources(): Promise<Readonly<Required<PhotoMediaMaskRasterResourcesV1>>>;
	}>;
	readonly originalTickets: Readonly<{
		transport: Readonly<Required<DesktopPhotoOriginalTransportCurrentV1>>;
	}>;
	close(): Promise<void>;
}

/** Complete selected-epoch storage supplied to the local Current Session
 * factory. Every capability is required, including saved-collection backup,
 * streamed writes, inspection/repair, shared previews and grouped Originals.
 * Physical reader and filesystem authority remain with the native owner. */
export interface DesktopPhotoLibrarySessionStorageCurrentV1 {
	readonly catalogId: string;
	readonly selectionToken: string;
	readonly signal: AbortSignal;
	readonly components: Readonly<Components>;
	readonly importPresets: ImportPresets;
	readonly exclusive: PhotoCatalogImportExclusiveV1;
	stop(): void;
	close(): Promise<void>;
}

/** Internal local client/factory interface, never an IPC message containing
 * functions. The production client must authenticate and own its connection;
 * localOwner.close joins actual renderer consumers before physical retirement. */
export interface DesktopPhotoLibrarySessionServiceCurrentV1 {
	open(options: Readonly<{ name: string; signal?: AbortSignal }>,
		localOwner: Readonly<{ close(): Promise<void> }>): Promise<Readonly<DesktopPhotoLibrarySessionStorageCurrentV1>>;
}
