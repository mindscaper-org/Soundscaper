/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PhotoLibrarySessionCurrentV1 } from '../src/lightscaper/controller/photo-library-session-current-v1.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from '../src/lightscaper/controller/photo-library-session-ports-current-v1.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { inspectPhotoFramescaperHandoffSourcesCurrentV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-inspect-current-v1.ts';
import { withDecodedImageHdrOriginalV1 } from '../src/common/editor/imaging/image-hdr-original-v1.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { hdrFrameFixtureCurrentV1, HDR_FRAME_SAMPLES } from './helpers/lightscaper-hdr-frame-current-fixture.ts';
import { createSparseHandoffArchive } from './helpers/lightscaper-sparse-handoff-archive-fixture.ts';
import { literalRepairSourceArchive } from './helpers/lightscaper-repair-frame-handoff-current-fixture.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });

async function hdrArchive() {
	const hdr = await hdrFrameFixtureCurrentV1(), store = createFramescaperProjectStore(PROFILE,
		{ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	try {
		await store.writeMediaAsset(hdr.source.storageKey, hdr.body,
			{ kind: 'timeline-image', encoding: 'framescaper-image-asset-v1', name: hdr.source.name, mimeType: hdr.source.mimeType });
		const project = hdr.project(); assert.ok(await store.createScapeProjectIfAbsent(project));
		const result = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store); assert.ok(result.blob);
		return { ...hdr, archive: result.blob };
	} finally { await store.close(); }
}

async function library() {
	const native = mediaRestoreFixture(), suffix = crypto.randomUUID(), mediaName = `lightscaper-hdr-capacity-media-${suffix}`, catalogName = `lightscaper-hdr-capacity-catalog-${suffix}`;
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, databaseName: mediaName, preferOpfs: false, locks: null });
	const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native.factory, databaseName: catalogName, verifyOriginal: media.verifyOriginal });
	let session: PhotoLibrarySessionCurrentV1 | undefined;
	async function closeResources(): Promise<void> {
		const outcomes = await Promise.allSettled([Promise.resolve().then(() => catalog.close()), Promise.resolve().then(() => media.close())]);
		const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : []);
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'HDR boundary fixture storage cleanup failed.', { cause: failures[0] });
	}
	try {
		await media.ready(); const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'destination',
			name: 'HDR boundary', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] }); await catalog.createCatalog(root);
		let mutations = 0, nextId = 0;
		const ports: PhotoLibrarySessionPortsCurrentV1 = { catalog, stacks: catalog, journal: media.settingsRepository,
			media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
			initialize: async () => (await catalog.loadCatalog(root.id))!, createId: () => `destination-${++nextId}`, now: () => '2026-10-27T00:00:00.000Z',
			exclusive: async (_catalog, run, signal) => { mutations++; return run(signal); },
			backup: { readSnapshot: catalog.readSnapshot.bind(catalog), captureSmartCollectionArchiveV1: catalog.captureSmartCollectionArchiveV1.bind(catalog),
				loadOriginal: (original, signal) => media.mediaRepository.loadAsset(original.storageKey, { signal, expectedSize: original.byteLength }) }, closeResources };
		const selected = new PhotoLibrarySessionCurrentV1(ports); session = selected; await selected.readPage();
		const current = selected.imageReceiveCurrent; assert.ok(current);
		return { session: selected, current, catalog, media, root, mutations: () => mutations, native, mediaName, catalogName, close: () => selected.close() };
	} catch (failure) {
		const outcomes = await Promise.allSettled([Promise.resolve().then(() => session ? session.close() : closeResources())]);
		for (const outcome of outcomes) if (outcome.status === 'rejected' && outcome.reason !== failure) {
			throw new AggregateError([failure, outcome.reason as unknown], 'HDR boundary fixture setup and cleanup failed.', { cause: failure });
		}
		throw failure;
	}
}

test('Current selected receive imports a genuinely inspected HDR ZIP above256MiB and preserves exact native Original custody', { timeout: 90_000 }, async t => {
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper-hdr-receive-')); t.after(() => rm(directory, { recursive: true, force: true }));
	const input = await hdrArchive(), target = await library(); t.after(() => target.close());
	const before = input.original.slice(), padded = await createSparseHandoffArchive(input.archive, join(directory, 'hdr.fscape'));
	assert.ok(padded.archive.size > 256 * 1024 * 1024); assert.ok(padded.archive.size < 257 * 1024 * 1024);
	await padded.verifyPadding();
	const mutations = target.mutations(), inspection = await inspectPhotoFramescaperHandoffSourcesCurrentV1({ archive: padded.archive });
	assert.equal(inspection.sources.length, 1); assert.equal(inspection.sources[0]!.sourceId, input.source.id); assert.equal(target.mutations(), mutations);
	const receipt = await target.current.receive({ archive: padded.archive, sourceId: input.source.id });
	assert.equal(receipt.status, 'imported'); assert.equal(receipt.settlement, 'complete'); assert.equal(target.mutations(), mutations + 1);
	const photo = await target.catalog.loadPhoto(receipt.catalogId, receipt.photoId); assert.ok(photo); assert.equal(photo.schemaVersion, 3);
	assert.deepEqual(photo.versions.find(version => version.id === photo.activeVersionId)!.develop, input.source.develop);
	const body = await target.media.mediaRepository.loadAsset(photo.original.storageKey); assert.ok(body);
	const bytes = new Uint8Array(await body.arrayBuffer()); assert.deepEqual(bytes, before); assert.deepEqual(input.original, before);
	await withDecodedImageHdrOriginalV1({ bytes }, decoded => {
		assert.equal(decoded.pixelsSha256, input.hdr.pixelsSha256);
		assert.deepEqual([...decoded.frame.pixels], [...Float32Array.from(HDR_FRAME_SAMPLES)]);
	});
	const roots = await target.media.mediaRepository.catalogOriginals.readPage({ catalogId: receipt.catalogId });
	assert.ok(roots.roots.some(root => root.photoId === photo.id && root.assetId === photo.original.storageKey));
	await target.close();
	const media = new PhotoMediaStoreV1({ indexedDB: target.native.factory, databaseName: target.mediaName, preferOpfs: false, locks: null });
	try {
		await media.ready(); const reopened = new PhotoCatalogRepositoryCurrentV1({ indexedDB: target.native.factory,
			databaseName: target.catalogName, verifyOriginal: media.verifyOriginal });
		try {
			assert.deepEqual(await reopened.loadPhoto(receipt.catalogId, receipt.photoId), photo);
			await media.verifyOriginal(photo.original);
			const original = await media.mediaRepository.loadAsset(photo.original.storageKey); assert.ok(original);
			assert.deepEqual(new Uint8Array(await original.arrayBuffer()), before);
			assert.deepEqual(await media.mediaRepository.catalogOriginals.readPage({ catalogId: receipt.catalogId }), roots);
		} finally { await reopened.close(); }
	} finally { await media.close(); }
});

test('fixed legacy256MiB and Current512MiB outer receive bounds refuse actual file-backed archives before mutation', { timeout: 90_000 }, async t => {
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper-hdr-bounds-')); t.after(() => rm(directory, { recursive: true, force: true }));
	const input = await hdrArchive(), target = await library(); t.after(() => target.close());
	const legacy = await createSparseHandoffArchive(input.archive, join(directory, 'legacy.fscape'));
	const current = await createSparseHandoffArchive(input.archive, join(directory, 'current.fscape'), 2_048), mutations = target.mutations();
	assert.ok(legacy.archive.size > 256 * 1024 * 1024); assert.ok(current.archive.size > 512 * 1024 * 1024);
	await assert.rejects(target.session.imageReceive.receive({ archive: legacy.archive, sourceId: input.source.id }), /fixed byte bound/u);
	await assert.rejects(target.current.receive({ archive: current.archive, sourceId: input.source.id }), /fixed byte bound/u);
	assert.equal(target.mutations(), mutations); assert.equal((await target.catalog.loadCatalog(target.root.id))!.photoCount, 0);
});

test('Current non-HDR ZIP above256MiB retains the inner legacy envelope and publishes no Original', { timeout: 90_000 }, async t => {
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper-raster-bounds-')); t.after(() => rm(directory, { recursive: true, force: true }));
	const input = await literalRepairSourceArchive(defaultImageDevelopStateV1()), target = await library(); t.after(() => target.close());
	const padded = await createSparseHandoffArchive(input.archive, join(directory, 'raster.fscape')), mutations = target.mutations();
	await assert.rejects(target.current.receive({ archive: padded.archive, sourceId: input.sourceId }), /Non-HDR editable archives retain/u);
	assert.equal(target.mutations(), mutations + 1); assert.equal((await target.catalog.loadCatalog(target.root.id))!.photoCount, 0);
	assert.deepEqual((await target.media.mediaRepository.catalogOriginals.readPage({ catalogId: target.root.id })).roots, []);
});
