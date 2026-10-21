/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after } from 'node:test';
import { PhotoMediaStoreV1, PHOTO_MEDIA_NAMESPACES_V1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoCatalogRepositoryKernelV2 } from '../src/lightscaper/catalog/photo-catalog-repository-kernel-v2.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { verifyPhotoResourcesCurrentV1 } from '../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { createPhotoLibraryRestoreRuntimeV2 } from '../src/lightscaper/photo-library-restore-runtime-v2.ts';
import { exportPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-export-v5.ts';
import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { readResidentPhotoLibraryCurrent, seedCurrentAppPhoto, currentAppLocks } from './helpers/lightscaper-current-app-fixture.tsx';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { lutArchiveFixture, LUT_BODY, LUT_REFERENCE } from './helpers/lightscaper-lut-archive-fixture.ts';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';
import { readCurrentCatalogCompanionsV1 } from './helpers/lightscaper-current-catalog-companions-fixture.ts';
import { installDirectoryModel } from './helpers/lightscaper-opfs-original-staging-fixture.ts';

const priorRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (priorRange) Object.defineProperty(globalThis, 'IDBKeyRange', priorRange); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });

/** Only the filesystem boundary is supplied: actual MediaRepository/OPFS
 * owners choose the backend and preserve native Blob bytes and metadata. */
function filesystem() {
	const directories = new Map<string, Map<string, Blob>>(), reads: string[] = [];
	const handles = new Map<string, object>(), models: ReturnType<typeof installDirectoryModel>[] = [];
	let rootReads = 0;
	const storage = { async getDirectory() {
		rootReads++;
		return { async getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions) {
			const existing = handles.get(name); if (existing) return existing;
			let files = directories.get(name);
			if (!files) { if (!options?.create) throw new DOMException('Missing directory', 'NotFoundError'); files = new Map(); directories.set(name, files); }
			const captured = files;
			const directory = { async getFileHandle(path: string, demand?: FileSystemGetFileOptions) {
				if (!captured.has(path) && !demand?.create) throw new DOMException('Missing file', 'NotFoundError');
				return { async getFile() {
					reads.push(path); const body = captured.get(path); if (!body) throw new DOMException('Missing body', 'NotFoundError');
					return new File([body], path, { type: body.type });
				}, async createWritable() {
					let body: Blob | null = null;
					return { async write(value: Blob) { assert.ok(value instanceof Blob); body = value; },
						async close() { assert.ok(body); captured.set(path, body); }, async abort() { body = null; } };
				} };
			}, async removeEntry(path: string) { captured.delete(path); } };
			// Model the native intrinsic directory identity and IDB handle clone,
			// while the actual OPFS owner still authenticates and writes the body.
			models.push(installDirectoryModel({ directory })); handles.set(name, directory); return directory;
		} };
	} };
	const prior = Object.getOwnPropertyDescriptor(globalThis.navigator, 'storage');
	Object.defineProperty(globalThis.navigator, 'storage', { configurable: true, value: storage });
	return { directories, reads, rootReads: () => rootReads,
		restore() { for (const model of [...models].reverse()) model.reset();
			if (prior) Object.defineProperty(globalThis.navigator, 'storage', prior); else Reflect.deleteProperty(globalThis.navigator, 'storage'); } };
}

test('current observer loads the actual default OPFS original with its complete admitted key, digest and bytes', async () => {
	const fs = filesystem(), native = mediaRestoreFixture(), locks = currentAppLocks();
	let media: PhotoMediaStoreV1 | null = null, catalog: PhotoCatalogRepositoryV2 | null = null;
	try {
		const seeded = await seedCurrentAppPhoto(native.factory, locks), bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
		const digest = createHash('sha256').update(bytes).digest('hex');
		const photo = normalizePhotoDocumentV1({ ...seeded.photo, id: 'opfs-photo', original: { ...seeded.photo.original,
			id: 'opfs-source', storageKey: 'opfs-original', name: 'Native original.png', byteLength: bytes.length, contentSha256: digest } });
		media = new PhotoMediaStoreV1({ indexedDB: native.factory, locks });
		catalog = new PhotoCatalogRepositoryV2({ indexedDB: native.factory, verifyOriginal: media.verifyOriginal });
		await media.mediaRepository.writeAsset(photo.original.storageKey, new Blob([bytes], { type: photo.original.mimeType }));
		const row = native.raw(PHOTO_MEDIA_NAMESPACES_V1.databaseName).records(PHOTO_MEDIA_NAMESPACES_V1.databaseName, 'mediaAssets')
			.find(value => value.sourceId === photo.original.storageKey);
		assert.ok(row); assert.equal(row.storage, 'opfs'); assert.equal(row.sha256, digest); assert.equal(row.size, bytes.length);
		assert.equal(typeof row.path, 'string'); assert.equal(row.blob, undefined);
		const root = await catalog.loadCatalog(photo.catalogId); assert.ok(root);
		await catalog.publishPhotos(photo.catalogId, root.revision, [photo]);
		await media.mediaRepository.catalogOriginals.retain(photo.catalogId, [{ photoId: photo.id, assetId: photo.original.storageKey,
			sourceId: photo.original.id, sha256: digest, size: bytes.length }]);
		await catalog.close(); catalog = null; await media.close(); media = null;
		const observed = await readResidentPhotoLibraryCurrent([photo.id], native.factory);
		assert.equal(observed.namespace, null); assert.equal(observed.root?.id, photo.catalogId);
		assert.deepEqual(observed.photos, [{ photo, bytes: [...bytes] }]);
		assert.equal(createHash('sha256').update(new Uint8Array(observed.photos[0]!.bytes)).digest('hex'), digest);
		assert.ok(fs.reads.includes(row.path as string)); assert.ok(fs.rootReads() > 0);
		assert.equal(fs.directories.get(PHOTO_MEDIA_NAMESPACES_V1.opfsDirectoryName)?.size, 1);
	} finally { try { await Promise.all([media?.close(), catalog?.close()]); } finally { fs.restore(); } }
});

test('current observer follows actual private Restore2 IDB allocation and authenticates Photo2 and disabled LUT custody without OPFS reads', async () => {
	const fs = filesystem(), native = mediaRestoreFixture(), expected = lutArchiveFixture(), locks = currentAppLocks();
	const restore = createPhotoLibraryRestoreRuntimeV2({ name: 'Restored library', indexedDB: native.factory, locks });
	const anchor = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, preferOpfs: false });
	try {
		const staleBytes = new Uint8Array([9, 8, 7]);
		await anchor.mediaRepository.writeAsset(expected.record.photo.original.storageKey, new Blob([staleBytes]));
		const output = await exportPhotoCatalogArchiveV5(expected.root, [expected.record], [], null, [], expected.row,
			{ async withBytes(_reference, consume) { return consume(LUT_BODY); } });
		assert.ok(output.blob); assert.equal((await restore.restoreArchive(output.blob)).photoCount, 1);
		const selected = await readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { assert.fail('Private observation must not initialize default storage.'); } });
		assert.ok(selected.allocation); assert.match(selected.location.namespaceToken!, /^[a-f0-9]{32}$/u);
		const databaseName = selected.location.mediaDatabaseName;
		const row = native.raw(databaseName).records(databaseName, 'mediaAssets').find(value => value.sourceId === expected.record.photo.original.storageKey);
		assert.ok(row); assert.notEqual(row.storage, 'opfs'); assert.equal(row.sha256, expected.record.photo.original.contentSha256);
		assert.equal(row.size, expected.record.photo.original.byteLength); assert.equal(row.path, undefined);
		const observed = await readResidentPhotoLibraryCurrent([expected.record.photo.id], native.factory);
		assert.equal(observed.namespace, selected.location.namespaceToken); assert.deepEqual(observed.root, expected.root);
		const original = new Uint8Array(await expected.record.original.arrayBuffer());
		assert.deepEqual(observed.photos, [{ photo: expected.record.photo, bytes: [...original] }]);
		assert.equal(createHash('sha256').update(new Uint8Array(observed.photos[0]!.bytes)).digest('hex'), expected.record.photo.original.contentSha256);
		const retained = await anchor.mediaRepository.loadAsset(expected.record.photo.original.storageKey); assert.ok(retained instanceof Blob);
		assert.deepEqual(new Uint8Array(await retained.arrayBuffer()), staleBytes);
		assert.equal(fs.rootReads(), 0); assert.deepEqual(fs.reads, []); assert.equal(fs.directories.size, 0);
	} finally { try { await Promise.all([restore.close(), anchor.close()]); } finally { fs.restore(); } }
});

/** Genuine Current native publication retains disabled/unused resources in
 * redo and snapshot history while the active version remains the old recipe. */
async function currentPhoto3() {
	const native = mediaRestoreFixture(), locks = currentAppLocks(), seeded = await seedCurrentAppPhoto(native.factory, locks);
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, preferOpfs: false });
	const host = { cubeLutResources: () => media.getCubeLutResources(), maskRasterResources: () => media.getMaskRasterResources() };
	const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native.factory, verifyOriginal: media.verifyOriginal,
		verifyResources: (photo, signal) => verifyPhotoResourcesCurrentV1(photo, host, signal) });
	try {
		await media.ready(); const luts = await media.getCubeLutResources(), masks = await media.getMaskRasterResources();
		await luts.put(LUT_REFERENCE, LUT_BODY);
		const brush = await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: Uint8Array.of(0, 255) },
			prepared => masks.put(prepared.reference, prepared.bytes));
		const version = seeded.photo.versions[0]!, initial = version.develop, createdAt = '2026-10-21T00:00:00.000Z';
		const retained = replaceImageDevelopRepairSpotsV1({ ...initial, processVersion: 2,
			effects: [{ id: 'disabled-lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: LUT_REFERENCE } }],
			masks: [{ schemaVersion: 2, id: 'unused-brush', name: 'Retained brush', kind: 'matte',
				inputs: [{ name: 'Unused', sourceRef: brush.reference.storageKey, kind: 'raster' }],
				nodes: [{ id: 'solid', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 0.5, height: 0.5 }], outputNodeId: 'solid' }], maskBindings: [] },
			{ schemaVersion: 1, spots: [] });
		const document = normalizePhotoDocumentCurrentV1({ ...seeded.photo, schemaVersion: 3, versions: [{ ...version,
			workspace: { schemaVersion: 3, kind: 'photo-develop-workspace', cursor: 0,
				entries: [{ label: 'Original', createdAt, develop: initial }, { label: 'Redo', createdAt, develop: retained }],
				snapshots: [{ id: 'retained', name: 'Resources', createdAt, develop: retained }] } }] });
		const photo = await catalog.savePhoto(document, seeded.photo.revision), root = await catalog.loadCatalog(photo.catalogId); assert.ok(root);
		return { native, seeded, photo, root, lut: LUT_REFERENCE, brush: brush.reference };
	} finally { await Promise.all([catalog.close(), media.close()]); }
}

test('current observer reads genuine Photo3 with native Original and complete retained Current LUT/brush custody without migrating the seed', async () => {
	const f = await currentPhoto3(); assert.equal(f.seeded.photo.schemaVersion, 1); assert.equal(f.photo.schemaVersion, 3);
	const observed = await readResidentPhotoLibraryCurrent([f.photo.id], f.native.factory);
	assert.equal(observed.namespace, null); assert.deepEqual(observed.root, f.root);
	assert.deepEqual(observed.photos, [{ photo: f.photo, bytes: [1, 2, 3] }]);
	assert.equal(createHash('sha256').update(new Uint8Array(observed.photos[0]!.bytes)).digest('hex'), f.photo.original.contentSha256);
	assert.deepEqual(observed.photos[0]!.photo.original, f.seeded.photo.original);
});

for (const resource of ['lut', 'brush'] as const) test(`current observer refuses a missing retained Current ${resource} body after genuine Photo3 publication`, async () => {
	const f = await currentPhoto3();
	const before = await readResidentPhotoLibraryCurrent([f.photo.id], f.native.factory); assert.deepEqual(before.photos[0]!.photo, f.photo);
	await f.native.remove(PHOTO_MEDIA_NAMESPACES_V1.databaseName, 'analysis', f[resource].storageKey);
	await assert.rejects(readResidentPhotoLibraryCurrent([f.photo.id], f.native.factory),
		{ name: 'ReferenceError', message: resource === 'lut' ? 'The LUT body is missing.' : 'The brush body is missing.' });
});

test('current observer joins a held execution observation before closing its borrowed catalog and media owners', async context => {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory, currentAppLocks());
	const release = deferred<void>(), mediaCloses: PhotoMediaStoreV1[] = [], catalogCloses: PhotoCatalogRepositoryKernelV2[] = [];
	const closeMedia = PhotoMediaStoreV1.prototype.close, closeCatalog = PhotoCatalogRepositoryKernelV2.prototype.close;
	context.mock.method(PhotoMediaStoreV1.prototype, 'close', function (this: PhotoMediaStoreV1) {
		mediaCloses.push(this); return Reflect.apply(closeMedia, this, []);
	});
	context.mock.method(PhotoCatalogRepositoryKernelV2.prototype, 'close', function (this: PhotoCatalogRepositoryKernelV2) {
		catalogCloses.push(this); return Reflect.apply(closeCatalog, this, []);
	});
	let entered = false, finished = false;
	const observing = readResidentPhotoLibraryCurrent([seeded.photo.id], native.factory, async () => {
		entered = true; await release.promise;
	});
	void observing.then(() => { finished = true; }, () => { finished = true; });
	try {
		await waitFor(() => entered, 'borrowed execution observation'); await settle();
		assert.equal(finished, false); assert.deepEqual(mediaCloses, []); assert.deepEqual(catalogCloses, []);
		release.resolve(); const observed = await observing;
		assert.deepEqual(observed.photos, [{ photo: seeded.photo, bytes: [1, 2, 3] }]);
		assert.equal(mediaCloses.length, 2); assert.equal(new Set(mediaCloses).size, 1); assert.equal(catalogCloses.length, 1);
	} finally { release.resolve(); await observing; }
});

test('current observer rejects the exact execution failure after joining its borrowed owner cleanup', async context => {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory, currentAppLocks());
	const release = deferred<void>(), failure = Object.freeze({ nativeWorkerFailure: 'closed execution context' });
	const closeMedia = PhotoMediaStoreV1.prototype.close, closeCatalog = PhotoCatalogRepositoryKernelV2.prototype.close;
	let mediaCloses = 0, catalogCloses = 0, finished = false;
	context.mock.method(PhotoMediaStoreV1.prototype, 'close', function (this: PhotoMediaStoreV1) {
		mediaCloses++; return Reflect.apply(closeMedia, this, []);
	});
	context.mock.method(PhotoCatalogRepositoryKernelV2.prototype, 'close', async function (this: PhotoCatalogRepositoryKernelV2) {
		catalogCloses++; await release.promise; return Reflect.apply(closeCatalog, this, []);
	});
	const observing = readResidentPhotoLibraryCurrent([seeded.photo.id], native.factory, async () => { throw failure; });
	void observing.then(() => { finished = true; }, () => { finished = true; });
	try {
		await waitFor(() => catalogCloses === 1, 'borrowed catalog cleanup'); await settle();
		assert.equal(finished, false); assert.equal(mediaCloses, 2);
		release.resolve(); await assert.rejects(observing, error => Object.is(error, failure));
	} finally { release.resolve(); await observing.catch(() => undefined); }
});

test('current catalog companions join execution observations before both nested and outer borrowed owners close', async context => {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory, currentAppLocks());
	const nested = deferred<void>(), outer = deferred<void>(), mediaCloses: PhotoMediaStoreV1[] = [], catalogCloses: PhotoCatalogRepositoryKernelV2[] = [];
	const closeMedia = PhotoMediaStoreV1.prototype.close, closeCatalog = PhotoCatalogRepositoryKernelV2.prototype.close;
	context.mock.method(PhotoMediaStoreV1.prototype, 'close', function (this: PhotoMediaStoreV1) {
		mediaCloses.push(this); return Reflect.apply(closeMedia, this, []);
	});
	context.mock.method(PhotoCatalogRepositoryKernelV2.prototype, 'close', function (this: PhotoCatalogRepositoryKernelV2) {
		catalogCloses.push(this); return Reflect.apply(closeCatalog, this, []);
	});
	let observations = 0;
	const observing = readCurrentCatalogCompanionsV1([seeded.photo.id], native.factory, async () => {
		observations++; await (observations === 1 ? nested.promise : outer.promise);
	});
	try {
		await waitFor(() => observations === 1, 'nested execution observation');
		assert.deepEqual(mediaCloses, []); assert.deepEqual(catalogCloses, []);
		nested.resolve(); await waitFor(() => observations === 2, 'outer execution observation');
		assert.equal(mediaCloses.length, 2); assert.equal(catalogCloses.length, 1);
		outer.resolve(); const observed = await observing;
		assert.deepEqual(observed.photos.map(({ photo, bytes }) => ({ photo, bytes })), [{ photo: seeded.photo, bytes: [1, 2, 3] }]);
		assert.equal(observations, 2); assert.equal(mediaCloses.length, 4); assert.equal(new Set(mediaCloses).size, 2); assert.equal(catalogCloses.length, 2);
	} finally { nested.resolve(); outer.resolve(); await observing; }
});
