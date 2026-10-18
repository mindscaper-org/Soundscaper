/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAbsolute, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
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
import type { PhotoQueryPageRequestV2, PhotoQueryPageV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import type { PhotoQueryBuildProgressV2 } from '../src/lightscaper/catalog/photo-query-index-storage-v2.ts';
import { admitLightscaperNativeQueryPageCurrentV1, readAdmittedLightscaperNativeQueryPageCurrentV1 } from './lightscaper-native-query-pages-current-v1.ts';
import { rebuildLightscaperNativeQueryIndexPageCurrentV1 } from './lightscaper-native-query-rebuild-current-v1.ts';

type Options = Readonly<{ signal?: AbortSignal }>;
type OpenOptions = Readonly<{ appDataPath: string; verifyResources?: LightscaperNativeCatalogVerificationCurrentV1['verifyResources'] }>;

/** Main-private native component, not a renderer repository or IPC facade.
 * Full query/stack/resource/session ports are required before app activation. */
export class LightscaperNativeCatalogStoreCurrentV1 {
	readonly #database: DatabaseSync;
	readonly #originals: LightscaperNativeOriginalStoreCurrentV1;
	readonly #verification: LightscaperNativeCatalogVerificationCurrentV1;
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
		return this.#request(() => ({ root: normalizePhotoCatalogRootV1(value), expected: revision(expectedRevision), signal: signal(options) }), captured => {
			check(captured.signal); return saveCatalog(this.#database, captured.root, captured.expected);
		});
	}
	readSummaryPage(catalogId: string, options: LightscaperNativeCatalogSummaryPageRequestCurrentV1 = {}): Promise<PhotoSummaryPageV1> {
		return this.#request(() => admitLightscaperNativeCatalogSummaryPageCurrentV1(catalogId, options),
			value => readAdmittedLightscaperNativeCatalogSummaryPageCurrentV1(this.#database, value));
	}
	readSnapshot(catalogId: string, options: Options = {}): Promise<LightscaperNativeCatalogSnapshotViewCurrentV1 | null> {
		return this.#request(() => admitLightscaperNativeCatalogSnapshotCurrentV1(catalogId, options),
			value => readLightscaperNativeCatalogSnapshotCurrentV1(this.#database, value.catalogId, { signal: value.signal }));
	}
	readQueryPageV2(catalogId: string, options: PhotoQueryPageRequestV2 = {}): Promise<PhotoQueryPageV2> {
		return this.#request(() => admitLightscaperNativeQueryPageCurrentV1(catalogId, options),
			value => readAdmittedLightscaperNativeQueryPageCurrentV1(this.#database, value));
	}
	rebuildQueryIndexPageV2(catalogId: string, options: Options = {}): Promise<PhotoQueryBuildProgressV2> {
		return this.#request(() => ({ catalogId: id(catalogId, 'query rebuild catalog ID'), signal: signal(options) }),
			value => rebuildLightscaperNativeQueryIndexPageCurrentV1(this.#database, value.catalogId, { signal: value.signal }));
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
		this.#closing ??= this.#tail.then(async () => {
			const failures: unknown[] = [];
			try { this.#database.close(); } catch (error) { failures.push(error); }
			try { await this.#originals.close(); } catch (error) { failures.push(error); }
			if (failures.length) throw new AggregateError(failures, 'Native catalog owner retirement failed.');
		});
		return this.#closing;
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
