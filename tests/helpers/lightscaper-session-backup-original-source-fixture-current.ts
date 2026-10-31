/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import type { PhotoLibraryOriginalSourceCurrentV1 } from '../../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import { mediaRestoreFixture } from './lightscaper-media-restore-fixture.ts';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';
import { InstrumentedKeyRange } from './instrumented-indexeddb-keys.ts';

/** Actual Web Core repositories and immutable Files. This isolates Session
 * capability composition; native OPFS/IPC qualification remains separate. */
export async function sessionBackupOriginalSourceFixtureCurrentV1() {
	const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
	const native = mediaRestoreFixture(), suffix = crypto.randomUUID();
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, databaseName: `lightscaper-source-backup-media-${suffix}`, preferOpfs: false, locks: null });
	const catalog = new PhotoCatalogRepositoryV1({ indexedDB: native.factory, databaseName: `lightscaper-source-backup-catalog-${suffix}`, verifyOriginal: media.verifyOriginal });
	const sources = [photoArchiveFixture(1), photoArchiveFixture(2)], active = new Set<File>();
	const calls = { acquisitions: 0, releases: 0, resourceCloses: 0 }, hooks = {
		acquire: async (): Promise<void> => undefined, closeLease: async (): Promise<void> => undefined,
	};
	let closing: Promise<void> | undefined;
	const closeResources = (): Promise<void> => {
		closing ??= (async () => {
			calls.resourceCloses++; const results = await Promise.allSettled([catalog.close(), media.close()]);
			const errors = results.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []);
			if (errors.length) throw new AggregateError(errors, 'Scoped backup fixture storage did not retire.');
		})(); return closing;
	};
	const restore = () => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); };
	try {
		Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
		await media.ready();
		for (const source of sources) {
			await media.mediaRepository.writeAsset(source.photo.original.storageKey, source.original);
			await media.mediaRepository.catalogOriginals.retain(source.photo.catalogId, [{ photoId: source.photo.id,
				sourceId: source.photo.original.id, assetId: source.photo.original.storageKey,
				sha256: source.photo.original.contentSha256, size: source.photo.original.byteLength }]);
		}
		const initial = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1',
			name: 'Scoped backup', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
		await catalog.createCatalog(initial); const root = await catalog.publishPhotos(initial.id, 0, sources.map(source => source.photo));
		const originalSource: PhotoLibraryOriginalSourceCurrentV1 = { async acquire(request, options) {
			assert.equal(this, originalSource); calls.acquisitions++;
			const source = sources.find(source => source.photo.id === request.photoId); assert.ok(source);
			assert.equal(request.catalogId, root.id); assert.deepEqual(request.original, source.photo.original);
			await media.verifyOriginal(request.original, options?.signal);
			const body = await media.mediaRepository.loadAsset(request.original.storageKey, { expectedSize: request.original.byteLength, signal: options?.signal });
			assert.ok(body instanceof Blob); const file = new File([body], request.original.name); active.add(file);
			await hooks.acquire();
			return { body: file, async close() { await hooks.closeLease(); active.delete(file); calls.releases++; } };
		} };
		const ports = { catalog, stacks: catalog, originalSource,
			backup: { readSnapshot: catalog.readSnapshot.bind(catalog), captureSmartCollectionArchiveV1: catalog.captureSmartCollectionArchiveV1.bind(catalog) },
			developPresetSettings: media.settingsRepository, journal: media.settingsRepository,
			media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
			cubeLutResources: () => media.getCubeLutResources(), maskRasterResources: () => media.getMaskRasterResources(),
			initialize: async () => root, exclusive: async <Result>(_id: string, run: (signal?: AbortSignal) => Promise<Result>, signal?: AbortSignal) => run(signal), closeResources };
		return { ports, catalog, media, root, sources, originalSource, hooks, calls, active,
			async close() { try { await closeResources(); } finally { restore(); } } };
	} catch (error) { try { await closeResources(); } finally { restore(); } throw error; }
}
