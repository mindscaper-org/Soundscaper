/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { readValidatedPhotoCatalogRootV1 } from '../src/lightscaper/catalog/documents.ts';
import { normalizePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { capturePhotoDerivedPublicationGuardCurrentV1 } from '../src/lightscaper/catalog/photo-derived-publication-current-v1.ts';
import { assertPhotoStackQuerySignalV1 } from '../src/lightscaper/catalog/photo-stack-query-signal-v1.ts';
import { PHOTO_CATALOG_REPOSITORY_LIMITS, PhotoCatalogClosedError, type PhotoSummaryPageV1 } from '../src/lightscaper/catalog/repository-types.ts';
import type { PhotoCatalogRootV1, PhotoOriginalV1 } from '../src/lightscaper/catalog/types.ts';
import { array, field, id, integer, record } from '../src/lightscaper/catalog/value-validation.ts';
import { admitLightscaperNativeCatalogPhotosCurrentV1, type LightscaperNativeCatalogVerificationCurrentV1 } from './lightscaper-native-catalog-admission-current-v1.ts';
import { openLightscaperNativeCatalogDatabaseCurrentV1 } from './lightscaper-native-catalog-files-current-v1.ts';
import { admitLightscaperNativeCatalogSnapshotCurrentV1, admitLightscaperNativeCatalogSummaryPageCurrentV1,
	readAdmittedLightscaperNativeCatalogSummaryPageCurrentV1, readLightscaperNativeCatalogSnapshotCurrentV1,
	type LightscaperNativeCatalogSummaryPageRequestCurrentV1, type LightscaperNativeCatalogSnapshotViewCurrentV1 } from './lightscaper-native-catalog-pages-current-v1.ts';
import { createLightscaperNativeCatalogCurrentV1 as create, loadLightscaperNativeCatalogCurrentV1 as loadCatalog,
	loadLightscaperNativePhotoCurrentV1 as loadPhoto, publishLightscaperNativePhotosCurrentV1 as publish,
	publishDerivedLightscaperNativePhotoCurrentV1 as publishDerived, saveLightscaperNativeCatalogCurrentV1 as saveCatalog,
	saveLightscaperNativePhotoCurrentV1 as savePhoto } from './lightscaper-native-catalog-transactions-current-v1.ts';
import { readLightscaperNativeOriginalCurrentV1 } from './lightscaper-native-original-contract-current-v1.ts';
import { LightscaperNativeOriginalStoreCurrentV1 } from './lightscaper-native-original-store-current-v1.ts';
import type { PhotoLibraryCullingNavigationContextV1, PhotoLibraryCullingNavigationRequestV1 } from '../src/common/editor/photo-library-culling-navigation-port-v1.ts';
import type { PhotoLibraryPageV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { admitLightscaperNativeCullingNavigationCurrentV1 } from './lightscaper-native-culling-admission-current-v1.ts';
import { readAdmittedLightscaperNativeCullingDestinationPageCurrentV1 } from './lightscaper-native-culling-current-v1.ts';
import type { PhotoQueryPageRequestV2, PhotoQueryPageV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import type { PhotoQueryBuildProgressV2 } from '../src/lightscaper/catalog/photo-query-index-storage-v2.ts';
import { admitLightscaperNativeQueryPageCurrentV1, readAdmittedLightscaperNativeQueryPageCurrentV1 } from './lightscaper-native-query-pages-current-v1.ts';
import { rebuildLightscaperNativeQueryIndexPageCurrentV1 } from './lightscaper-native-query-rebuild-current-v1.ts';
import { admitPhotoStackSaveV1, readPhotoStackSignalOptionsV1, readPhotoStackWriteOptionsV1,
	type PhotoStackWriteOptionsV1, type PhotoStackPageOptionsV1, type PhotoStackMembershipPageOptionsV1,
	type PhotoStackSummaryV1, type PhotoStackMembershipV1, type PhotoStackMemberSummaryV1, type PhotoStackPageV1 } from '../src/lightscaper/catalog/photo-stack-repository-contract-v1.ts';
import type { PhotoStackV1, PhotoStackStateV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import { loadLightscaperNativeStackCurrentV1, readLightscaperNativeStackStateCurrentV1,
	saveLightscaperNativeStackCurrentV1, dissolveLightscaperNativeStackCurrentV1 } from './lightscaper-native-stack-transactions-current-v1.ts';
import { admitLightscaperNativeStackPageCurrentV1, admitLightscaperNativeStackMemberPageCurrentV1,
	readAdmittedLightscaperNativeStackPageCurrentV1, readAdmittedLightscaperNativeStackMembershipPageCurrentV1,
	readAdmittedLightscaperNativeStackMemberPageCurrentV1 } from './lightscaper-native-stack-pages-current-v1.ts';

import type { PhotoStackQueryPageRequestV2, PhotoStackQueryPageV2 } from '../src/lightscaper/catalog/photo-stack-query-types-v2.ts';
import { admitLightscaperNativeStackQueryPageCurrentV1, readAdmittedLightscaperNativeStackQueryPageCurrentV1 } from './lightscaper-native-stack-query-current-v1.ts';
import { retireLightscaperNativeStackQueryProgressCurrentV1 } from './lightscaper-native-stack-query-progress-current-v1.ts';
import type { PhotoQueryPageRequestV1, PhotoQueryPageV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import type { PhotoStackQueryPageRequestV1, PhotoStackQueryPageV1 } from '../src/lightscaper/catalog/photo-stack-query-types-v1.ts';
import { admitLightscaperNativeLegacyQueryPageCurrentV1, readAdmittedLightscaperNativeLegacyQueryPageCurrentV1 } from './lightscaper-native-legacy-query-pages-current-v1.ts';
import { rebuildLightscaperNativeLegacyQueryIndexPageCurrentV1 } from './lightscaper-native-legacy-query-rebuild-current-v1.ts';
import { admitLightscaperNativeLegacyStackQueryPageCurrentV1, readAdmittedLightscaperNativeLegacyStackQueryPageCurrentV1 } from './lightscaper-native-legacy-stack-query-current-v1.ts';
import { retireLightscaperNativeLegacyStackQueryProgressCurrentV1 } from './lightscaper-native-legacy-stack-query-progress-current-v1.ts';
import type { PhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import type { PhotoSmartCollectionsStateV1 } from '../src/lightscaper/catalog/photo-smart-collection-state-v1.ts';
import { readPhotoSmartCollectionSignalOptionsV1, type PhotoSmartCollectionSignalOptionsV1, type PhotoSmartCollectionPageOptionsV1,
	type PhotoSmartCollectionPageV1, type PhotoSmartCollectionWriteOptionsV1, type PhotoSmartCollectionWriteReceiptV1 } from '../src/lightscaper/catalog/photo-smart-collection-repository-types-v1.ts';
import { admitPhotoSmartCollectionArchiveContextRequestV1, type PhotoSmartCollectionSnapshotV1,
	type PhotoSmartCollectionArchiveContextV1, type PhotoSmartCollectionArchiveCaptureV1 } from '../src/lightscaper/catalog/photo-smart-collection-contract-v1.ts';
import type { PhotoSavedQueryPageRequestV1, PhotoSavedQueryPageV1 } from '../src/lightscaper/catalog/photo-smart-collection-query-types-v1.ts';
import { admitLightscaperNativeSmartCollectionPageCurrentV1, readAdmittedLightscaperNativeSmartCollectionPageCurrentV1,
	admitLightscaperNativeSmartCollectionSnapshotCurrentV1, readAdmittedLightscaperNativeSmartCollectionSnapshotCurrentV1,
	loadLightscaperNativeSmartCollectionCurrentV1, readLightscaperNativeSmartCollectionStateCurrentV1,
	readLightscaperNativeSmartCollectionArchiveContextCurrentV1 } from './lightscaper-native-smart-collection-pages-current-v1.ts';
import { admitLightscaperNativeSmartCollectionSaveCurrentV1, admitLightscaperNativeSmartCollectionDeleteCurrentV1,
	saveAdmittedLightscaperNativeSmartCollectionCurrentV1, deleteAdmittedLightscaperNativeSmartCollectionCurrentV1 } from './lightscaper-native-smart-collection-transactions-current-v1.ts';
import { prepareLightscaperNativeSmartCollectionRootGuardCurrentV1 } from './lightscaper-native-smart-collection-audit-current-v1.ts';
import { admitLightscaperNativeSmartCollectionQueryCurrentV1, readAdmittedLightscaperNativeSmartCollectionQueryCurrentV1 } from './lightscaper-native-smart-collection-query-current-v1.ts';
import { retireLightscaperNativeSavedQueryProgressCurrentV1 } from './lightscaper-native-smart-collection-query-progress-current-v1.ts';
import { createLightscaperNativeSmartCollectionArchiveCurrentV1 } from './lightscaper-native-smart-collection-archive-current-v1.ts';
import { LightscaperNativeSavedLifetimeCurrentV1 } from './lightscaper-native-saved-lifetime-current-v1.ts';

type Options = Readonly<{ signal?: AbortSignal }>;
type OpenOptions = Readonly<{ appDataPath: string; verifyResources?: LightscaperNativeCatalogVerificationCurrentV1['verifyResources'] }>;

/** Main-private native component, not a renderer repository or IPC facade.
 * Full query/stack/resource/session ports are required before app activation. */
export class LightscaperNativeCatalogStoreCurrentV1 {
	readonly #database: DatabaseSync;
	readonly #originals: LightscaperNativeOriginalStoreCurrentV1;
	readonly #verification: LightscaperNativeCatalogVerificationCurrentV1;
	readonly #savedLifetime = new LightscaperNativeSavedLifetimeCurrentV1();
	#tail: Promise<void> = Promise.resolve();
	#closing: Promise<void> | null = null;
	private constructor(database: DatabaseSync, originals: LightscaperNativeOriginalStoreCurrentV1,
		verifyResources: OpenOptions['verifyResources']) {
		this.#database = database; this.#originals = originals;
		this.#verification = Object.freeze({ verifyOriginal: (original: PhotoOriginalV1, signal?: AbortSignal) => originals.verify(original, { signal }),
			...(verifyResources === undefined ? {} : { verifyResources }) });
	}
	static async open(options: OpenOptions): Promise<LightscaperNativeCatalogStoreCurrentV1> {
		const input = record(options, 'native catalog owner', ['appDataPath', 'verifyResources'], ['appDataPath']);
		const root = field(input, 'appDataPath'), verify = Object.hasOwn(input, 'verifyResources') ? field(input, 'verifyResources') : undefined;
		if (typeof root !== 'string' || !isAbsolute(root) || resolve(root) !== root || root.includes('\0')) throw new TypeError('Native catalog appData requires a canonical absolute directory.');
		if (verify !== undefined && typeof verify !== 'function') throw new TypeError('Native catalog resource verification requires a function.');
		const originals = await LightscaperNativeOriginalStoreCurrentV1.open({ appDataPath: root });
		try {
			const database = await openLightscaperNativeCatalogDatabaseCurrentV1(root);
			const verifyResources = verify === undefined ? undefined : (photo: PhotoDocumentCurrentV1, signal?: AbortSignal): Promise<void> =>
				Reflect.apply(verify as NonNullable<OpenOptions['verifyResources']>, options, [photo, signal]);
			return new LightscaperNativeCatalogStoreCurrentV1(database, originals, verifyResources);
		} catch (error) {
			try { await originals.close(); }
			catch (cleanup) { throw new AggregateError([error, cleanup], 'Native catalog opening and Original retirement failed.', { cause: cleanup }); }
			throw error;
		}
	}

	createCatalog(value: unknown): Promise<void> {
		return this.#request(() => normalizePhotoCatalogRootV1(value), root => create(this.#database, root));
	}
	loadCatalog(catalogId: string): Promise<PhotoCatalogRootV1 | null> {
		return this.#request(() => id(catalogId, 'catalog ID'), key => loadCatalog(this.#database, key));
	}
	loadPhoto(catalogId: string, photoId: string): Promise<PhotoDocumentCurrentV1 | null> {
		return this.#request(() => keys(catalogId, photoId), key => loadPhoto(this.#database, key.catalogId, key.photoId));
	}
	publishPhotos(catalogId: string, expectedRevision: number, values: unknown, options: Options = {}): Promise<PhotoCatalogRootV1> {
		return this.#request(() => ({ catalogId: id(catalogId, 'catalog ID'), expected: revision(expectedRevision),
			photos: capturePhotos(values), signal: signal(options) }), async value => {
			const admission = await admitLightscaperNativeCatalogPhotosCurrentV1(this.#database, value.photos, 'import', this.#verification, value.signal);
			check(value.signal); return publish(this.#database, value.catalogId, value.expected, admission);
		});
	}
	publishDerivedPhotoCurrentV1(catalogId: string, expectedRevision: number, selections: unknown, photo: unknown, options: Options = {}): Promise<PhotoCatalogRootV1> {
		return this.#request(() => {
			const document = normalizePhotoDocumentCurrentV1(photo);
			return { catalogId: id(catalogId, 'catalog ID'), expected: revision(expectedRevision), document,
				guard: capturePhotoDerivedPublicationGuardCurrentV1(catalogId, selections, document.id), signal: signal(options) };
		}, async value => {
			const admission = await admitLightscaperNativeCatalogPhotosCurrentV1(this.#database, [value.document], 'import', this.#verification, value.signal);
			check(value.signal); return publishDerived(this.#database, value.catalogId, value.expected, value.guard, admission);
		});
	}
	savePhoto(value: unknown, expectedRevision: number, options: Options = {}): Promise<PhotoDocumentCurrentV1> {
		return this.#request(() => ({ photo: normalizePhotoDocumentCurrentV1(value), expected: revision(expectedRevision), signal: signal(options) }), async captured => {
			const admission = await admitLightscaperNativeCatalogPhotosCurrentV1(this.#database, [captured.photo], 'edit', this.#verification, captured.signal);
			check(captured.signal); return savePhoto(this.#database, admission, captured.expected);
		});
	}
	saveCatalog(value: unknown, expectedRevision: number, options: Options = {}): Promise<PhotoCatalogRootV1> {
		return this.#request(() => ({ root: readValidatedPhotoCatalogRootV1(value), expected: revision(expectedRevision), signal: signal(options) }), captured => {
			return this.#savedLifetime.run(captured.signal, async privateSignal => {
				const guard = await prepareLightscaperNativeSmartCollectionRootGuardCurrentV1(this.#database, captured.root, captured.expected, { signal: privateSignal });
				check(privateSignal); return saveCatalog(this.#database, captured.root, captured.expected, guard, privateSignal);
			});
		});
	}
	readSummaryPage(catalogId: string, options: LightscaperNativeCatalogSummaryPageRequestCurrentV1 = {}): Promise<PhotoSummaryPageV1> {
		return this.#request(() => admitLightscaperNativeCatalogSummaryPageCurrentV1(catalogId, options),
			value => readAdmittedLightscaperNativeCatalogSummaryPageCurrentV1(this.#database, value));
	}
	readCullingDestinationPage(catalogId: string, context: PhotoLibraryCullingNavigationContextV1,
		request: PhotoLibraryCullingNavigationRequestV1): Promise<Readonly<PhotoLibraryPageV1> | null> {
		return this.#request(() => admitLightscaperNativeCullingNavigationCurrentV1(catalogId, context, request, this.#savedLifetime.shutdownSignal),
			captured => this.#savedLifetime.run(captured.signal, async privateSignal => {
				const page = await readAdmittedLightscaperNativeCullingDestinationPageCurrentV1(this.#database, captured, privateSignal);
				check(privateSignal); return page;
			}));
	}
	readSnapshot(catalogId: string, options: Options = {}): Promise<LightscaperNativeCatalogSnapshotViewCurrentV1 | null> {
		return this.#request(() => admitLightscaperNativeCatalogSnapshotCurrentV1(catalogId, options),
			value => readLightscaperNativeCatalogSnapshotCurrentV1(this.#database, value.catalogId, { signal: value.signal }));
	}
	readQueryPageV2(catalogId: string, options: PhotoQueryPageRequestV2 = {}): Promise<PhotoQueryPageV2> {
		return this.#request(() => admitLightscaperNativeQueryPageCurrentV1(catalogId, options),
			value => readAdmittedLightscaperNativeQueryPageCurrentV1(this.#database, value));
	}
	readQueryPage(catalogId: string, options: PhotoQueryPageRequestV1 = {}): Promise<PhotoQueryPageV1> {
		return this.#request(() => admitLightscaperNativeLegacyQueryPageCurrentV1(catalogId, options),
			value => readAdmittedLightscaperNativeLegacyQueryPageCurrentV1(this.#database, value));
	}
	readStackQueryPage(catalogId: string, options: PhotoStackQueryPageRequestV1 = {}): Promise<PhotoStackQueryPageV1> {
		return this.#request(() => admitLightscaperNativeLegacyStackQueryPageCurrentV1(catalogId, options),
			value => readAdmittedLightscaperNativeLegacyStackQueryPageCurrentV1(this.#database, value));
	}
	rebuildQueryIndexPage(catalogId: string, options: Options = {}): Promise<Readonly<{ processed: number; bytes: number; ready: boolean }>> {
		return this.#request(() => ({ catalogId: id(catalogId, 'legacy query rebuild catalog ID'), signal: signal(options) }),
			value => rebuildLightscaperNativeLegacyQueryIndexPageCurrentV1(this.#database, value.catalogId, { signal: value.signal }));
	}
	readStackQueryPageV2(catalogId: string, options: PhotoStackQueryPageRequestV2 = {}): Promise<PhotoStackQueryPageV2> {
		return this.#request(() => admitLightscaperNativeStackQueryPageCurrentV1(catalogId, options),
			value => readAdmittedLightscaperNativeStackQueryPageCurrentV1(this.#database, value));
	}
	rebuildQueryIndexPageV2(catalogId: string, options: Options = {}): Promise<PhotoQueryBuildProgressV2> {
		return this.#request(() => ({ catalogId: id(catalogId, 'query rebuild catalog ID'), signal: signal(options) }),
			value => rebuildLightscaperNativeQueryIndexPageCurrentV1(this.#database, value.catalogId, { signal: value.signal }));
	}
	loadStack(catalogId: string, stackId: string, options: Options = {}): Promise<PhotoStackV1 | null> {
		return this.#request(() => ({ catalogId: id(catalogId, 'stack catalog ID'), stackId: id(stackId, 'stack ID'),
			options: readPhotoStackSignalOptionsV1(options) }), value =>
			loadLightscaperNativeStackCurrentV1(this.#database, value.catalogId, value.stackId, value.options));
	}
	readStackState(catalogId: string, options: Options = {}): Promise<PhotoStackStateV1> {
		return this.#request(() => ({ catalogId: id(catalogId, 'stack catalog ID'), options: readPhotoStackSignalOptionsV1(options) }),
			value => readLightscaperNativeStackStateCurrentV1(this.#database, value.catalogId, value.options));
	}
	readStackPage(catalogId: string, options: PhotoStackPageOptionsV1 = {}): Promise<PhotoStackPageV1<PhotoStackSummaryV1>> {
		return this.#request(() => admitLightscaperNativeStackPageCurrentV1(catalogId, options),
			value => readAdmittedLightscaperNativeStackPageCurrentV1(this.#database, value));
	}
	readStackMembershipPage(catalogId: string, options: PhotoStackMembershipPageOptionsV1 = {}): Promise<PhotoStackPageV1<PhotoStackMembershipV1>> {
		return this.#request(() => admitLightscaperNativeStackPageCurrentV1(catalogId, options, 'memberships'),
			value => readAdmittedLightscaperNativeStackMembershipPageCurrentV1(this.#database, value));
	}
	readStackMemberPage(catalogId: string, stackId: string, expectedStackRevision: number, photoIds: readonly string[], options: Options = {}): Promise<readonly PhotoStackMemberSummaryV1[]> {
		return this.#request(() => admitLightscaperNativeStackMemberPageCurrentV1(catalogId, stackId, expectedStackRevision, photoIds, options),
			value => readAdmittedLightscaperNativeStackMemberPageCurrentV1(this.#database, value));
	}
	saveStack(value: unknown, expectedStackRevision: number | null, options: PhotoStackWriteOptionsV1): Promise<PhotoStackV1> {
		return this.#request(() => ({ stack: admitPhotoStackSaveV1(value, expectedStackRevision), expected: expectedStackRevision,
			options: readPhotoStackWriteOptionsV1(options) }), captured =>
			saveLightscaperNativeStackCurrentV1(this.#database, captured.stack, captured.expected, captured.options));
	}
	dissolveStack(catalogId: string, stackId: string, expectedStackRevision: number, options: PhotoStackWriteOptionsV1): Promise<PhotoStackStateV1> {
		return this.#request(() => ({ catalogId: id(catalogId, 'stack catalog ID'), stackId: id(stackId, 'stack ID'),
			expected: revision(expectedStackRevision), options: readPhotoStackWriteOptionsV1(options) }), value =>
			dissolveLightscaperNativeStackCurrentV1(this.#database, value.catalogId, value.stackId, value.expected, value.options));
	}
	loadSmartCollection(catalogId: string, collectionId: string, options: PhotoSmartCollectionSignalOptionsV1 = {}): Promise<Readonly<PhotoSmartCollectionV1> | null> {
		return this.#request(() => ({ catalogId: id(catalogId, 'saved catalog ID'), collectionId: id(collectionId, 'saved collection ID'),
			options: readPhotoSmartCollectionSignalOptionsV1(options) }), value =>
			loadLightscaperNativeSmartCollectionCurrentV1(this.#database, value.catalogId, value.collectionId, value.options));
	}
	readSmartCollectionState(catalogId: string, options: PhotoSmartCollectionSignalOptionsV1 = {}): Promise<Readonly<PhotoSmartCollectionsStateV1>> {
		return this.#request(() => ({ catalogId: id(catalogId, 'saved catalog ID'), options: readPhotoSmartCollectionSignalOptionsV1(options) }), value =>
			readLightscaperNativeSmartCollectionStateCurrentV1(this.#database, value.catalogId, value.options));
	}
	readSmartCollectionPage(catalogId: string, options: PhotoSmartCollectionPageOptionsV1 = {}): Promise<PhotoSmartCollectionPageV1> {
		return this.#request(() => admitLightscaperNativeSmartCollectionPageCurrentV1(catalogId, options), value =>
			readAdmittedLightscaperNativeSmartCollectionPageCurrentV1(this.#database, value));
	}
	readSmartCollectionSnapshotV1(catalogId: string, selectedId: string | null, options: PhotoSmartCollectionSignalOptionsV1 = {}): Promise<PhotoSmartCollectionSnapshotV1> {
		return this.#request(() => admitLightscaperNativeSmartCollectionSnapshotCurrentV1(catalogId, selectedId, options), value =>
			readAdmittedLightscaperNativeSmartCollectionSnapshotCurrentV1(this.#database, value));
	}
	saveSmartCollection(value: unknown, expectedRevision: number | null, options: PhotoSmartCollectionWriteOptionsV1): Promise<Readonly<PhotoSmartCollectionWriteReceiptV1>> {
		return this.#request(() => admitLightscaperNativeSmartCollectionSaveCurrentV1(value, expectedRevision, options), captured =>
			this.#savedLifetime.run(captured.options.signal, privateSignal => saveAdmittedLightscaperNativeSmartCollectionCurrentV1(this.#database, captured, privateSignal)));
	}
	deleteSmartCollection(catalogId: string, collectionId: string, expectedRevision: number, options: PhotoSmartCollectionWriteOptionsV1): Promise<Readonly<PhotoSmartCollectionWriteReceiptV1>> {
		return this.#request(() => admitLightscaperNativeSmartCollectionDeleteCurrentV1(catalogId, collectionId, expectedRevision, options), captured =>
			this.#savedLifetime.run(captured.options.signal, privateSignal => deleteAdmittedLightscaperNativeSmartCollectionCurrentV1(this.#database, captured, privateSignal)));
	}
	readSmartCollectionQueryPageV1(catalogId: string, collectionId: string, options: PhotoSavedQueryPageRequestV1 = {}): Promise<PhotoSavedQueryPageV1> {
		return this.#request(() => admitLightscaperNativeSmartCollectionQueryCurrentV1(catalogId, collectionId, 'ordinary', options), value =>
			readAdmittedLightscaperNativeSmartCollectionQueryCurrentV1(this.#database, value));
	}
	readSmartCollectionStackQueryPageV1(catalogId: string, collectionId: string, options: PhotoSavedQueryPageRequestV1 = {}): Promise<PhotoSavedQueryPageV1> {
		return this.#request(() => admitLightscaperNativeSmartCollectionQueryCurrentV1(catalogId, collectionId, 'collapsed', options), value =>
			readAdmittedLightscaperNativeSmartCollectionQueryCurrentV1(this.#database, value));
	}
	readSmartCollectionArchiveContextV1(catalogId: string, options: PhotoSmartCollectionSignalOptionsV1 = {}): Promise<PhotoSmartCollectionArchiveContextV1> {
		return this.#request(() => admitPhotoSmartCollectionArchiveContextRequestV1(catalogId, options), value =>
			readLightscaperNativeSmartCollectionArchiveContextCurrentV1(this.#database, value.catalogId, { signal: value.signal }));
	}
	captureSmartCollectionArchiveV1(catalogId: string, options: PhotoSmartCollectionSignalOptionsV1 = {}): Promise<PhotoSmartCollectionArchiveCaptureV1> {
		return this.#request(() => admitPhotoSmartCollectionArchiveContextRequestV1(catalogId, options), value =>
			this.#savedLifetime.capture(value.signal, privateSignal => createLightscaperNativeSmartCollectionArchiveCurrentV1(this.#database, value.catalogId, { signal: privateSignal })));
	}
	storeOriginal(value: unknown, chunks: AsyncIterable<Uint8Array>, options: Options = {}): Promise<Readonly<PhotoOriginalV1>> {
		return this.#request(() => ({ original: readLightscaperNativeOriginalCurrentV1(value), signal: signal(options) }),
			captured => this.#originals.store(captured.original, chunks, { signal: captured.signal }));
	}
	/** Body authority comes from an actual stored selected Photo, never a caller
	 * Original descriptor, storage key, body digest or arbitrary file path. */
	readOriginal(catalogId: string, photoId: string, offset: number, length: number, options: Options = {}): Promise<Uint8Array> {
		return this.#request(() => ({ ...keys(catalogId, photoId), offset, length, signal: signal(options) }), value => {
			check(value.signal);
			const photo = loadPhoto(this.#database, value.catalogId, value.photoId);
			if (!photo) throw new ReferenceError('Selected Photo is missing.');
			return this.#originals.read(photo.original, value.offset, value.length, { signal: value.signal });
		});
	}
	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		let resolveClose!: () => void, rejectClose!: (error: unknown) => void;
		const closing = new Promise<void>((resolve, reject) => { resolveClose = resolve; rejectClose = reject; });
		// Cache the fence before synchronous abort listeners can reenter close.
		this.#closing = closing;
		const failures: unknown[] = [];
		try { this.#savedLifetime.stop(); } catch (error) { failures.push(error); }
		void this.#tail.then(async () => {
			let readersRetired = false;
			try { await this.#savedLifetime.retire(); readersRetired = true; } catch (error) { failures.push(error); }
			try { retireLightscaperNativeSavedQueryProgressCurrentV1(this.#database); } catch (error) { failures.push(error); }
			try { retireLightscaperNativeStackQueryProgressCurrentV1(this.#database); } catch (error) { failures.push(error); }
			try { retireLightscaperNativeLegacyStackQueryProgressCurrentV1(this.#database); } catch (error) { failures.push(error); }
			if (readersRetired) try { this.#database.close(); } catch (error) { failures.push(error); }
			try { await this.#originals.close(); } catch (error) { failures.push(error); }
			if (failures.length) throw new AggregateError(failures, 'Native catalog owner retirement failed.');
		}).then(resolveClose, rejectClose);
		return closing;
	}
	#request<C, T>(capture: () => C, run: (value: C) => T | Promise<T>): Promise<T> {
		if (this.#closing) return Promise.reject(new PhotoCatalogClosedError());
		let captured: { value: C } | undefined, failure: unknown;
		// Register before a borrowed Proxy can reenter close(). Capture synchronously
		// before waiting, and keep all async custody outside synchronous SQL.
		const task = this.#tail.then(() => { if (!captured) throw failure; return run(captured.value); });
		this.#tail = task.then(() => undefined, () => undefined);
		try { captured = { value: capture() }; } catch (error) { failure = error; }
		return task;
	}
}

function keys(catalogId: unknown, photoId: unknown) { return { catalogId: id(catalogId, 'catalog ID'), photoId: id(photoId, 'photo ID') }; }
function revision(value: unknown): number { return integer(value, 0, Number.MAX_SAFE_INTEGER, 'expected revision'); }
function capturePhotos(values: unknown): readonly PhotoDocumentCurrentV1[] {
	return Object.freeze(array(values, 'native catalog photos', 1, PHOTO_CATALOG_REPOSITORY_LIMITS.maximumImportPhotos).map(normalizePhotoDocumentCurrentV1));
}
function signal(options: Options): AbortSignal | undefined {
	const input = record(options, 'native catalog options', ['signal'], []), value = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (value !== undefined) assertPhotoStackQuerySignalV1(value);
	return value as AbortSignal | undefined;
}
function check(value: AbortSignal | undefined): void { if (value !== undefined) assertPhotoStackQuerySignalV1(value); }
