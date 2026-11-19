import test from 'node:test';
import assert from 'node:assert/strict';

import { createProjectStore } from '../src/common/editor/storage.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createVideoStorageOpfsModel as createOpfsDirectory, LyingBlob } from './helpers/video-storage-opfs-model-fixture.ts';

test('memory storage persists immutable media assets and timestamped video derivatives', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('media-memory'),
	});
	const original = new Blob(['original-video'], { type: 'video/webm' });
	const metadata = await store.writeMediaAsset('video-source', original, {
		name: 'scene.webm',
		width: 1280,
		height: 720,
		sha256: 'caller-supplied-digest-must-not-be-trusted',
	});

	assert.equal(metadata.sourceId, 'video-source');
	assert.equal(metadata.storage, 'indexeddb-blob');
	assert.equal(metadata.mimeType, 'video/webm');
	assert.equal(metadata.name, 'scene.webm');
	assert.equal(metadata.size, original.size);
	assert.equal(metadata.sha256, 'ddc5852cf5d92b542ec7d6efcc6d9c02a53f9692fd5f36e954896c21c7a8ac4e');
	assert.equal('blob' in metadata, false);
	assert.equal(await (await store.loadMediaAsset('video-source')).text(), 'original-video');
	assert.deepEqual(await store.getMediaAssetMetadata('video-source'), metadata);
	await assert.rejects(
		store.writeMediaAsset('video-source', new Blob(['replacement'])),
		/Immutable media asset video-source cannot be overwritten/,
	);

	await store.saveVideoDerivative('video-source', {
		timestamp: 5,
		type: 'thumbnail',
		blob: new Blob(['five'], { type: 'image/webp' }),
		metadata: { width: 160 },
	});
	await store.saveVideoDerivative('video-source', {
		timestamp: 0,
		type: 'poster',
		blob: new Blob(['poster'], { type: 'image/webp' }),
	});
	await store.saveVideoDerivative('video-source', {
		timestamp: 0,
		type: 'thumbnail',
		blob: new Blob(['zero'], { type: 'image/webp' }),
	});

	assert.deepEqual(
		(await store.listVideoDerivatives('video-source')).map(({ timestamp, type }) => [timestamp, type]),
		[[0, 'poster'], [0, 'thumbnail'], [5, 'thumbnail']],
	);
	assert.deepEqual(
		(await store.listVideoDerivatives('video-source', { type: 'thumbnail' })).map(({ timestamp }) => timestamp),
		[0, 5],
	);
	assert.equal(
		await (await store.loadVideoDerivative('video-source', { timestamp: 5, type: 'thumbnail' })).text(),
		'five',
	);

	await store.saveVideoDerivative('video-source', {
		timestamp: 5,
		type: 'thumbnail',
		blob: new Blob(['updated']),
	});
	assert.equal(
		await (await store.loadVideoDerivative('video-source', { timestamp: 5, type: 'thumbnail' })).text(),
		'updated',
	);
	await store.deleteVideoDerivative('video-source', { timestamp: 0, type: 'poster' });
	assert.equal(await store.loadVideoDerivative('video-source', { timestamp: 0, type: 'poster' }), null);
	assert.equal((await store.listVideoDerivatives('video-source')).length, 2);
});

for (const backend of ['memory', 'indexeddb', 'opfs-model']) {
	test(`${backend} concurrent direct media writes publish one immutable winner`, async context => {
		const files = new Map();
		const indexedDB = backend === 'memory' ? null : createInstrumentedIndexedDB();
		const databaseName = uniqueDatabaseName(`concurrent-media-${backend}`);
		const directory = createOpfsDirectory(files);
		const store = createProjectStore({
			indexedDB,
			memoryFallback: backend === 'memory',
			preferOpfs: backend === 'opfs-model',
			databaseName,
			storageManager: backend === 'opfs-model' ? {
				async getDirectory() { return { async getDirectoryHandle() { return directory; } }; },
			} : null,
		});
		context.after(() => store.close());
		const results = await Promise.allSettled([
			store.writeMediaAsset('shared-id', new Blob(['first']), { candidate: 'first' }),
			store.writeMediaAsset('shared-id', new Blob(['second']), { candidate: 'second' }),
		]);
		const fulfilled = results.filter((result) => result.status === 'fulfilled');
		const rejected = results.filter((result) => result.status === 'rejected');

		assert.equal(fulfilled.length, 1);
		assert.equal(rejected.length, 1);
		assert.match(String(rejected[0].reason), /immutable media asset shared-id cannot be overwritten/iu);
		const winner = fulfilled[0].value.candidate;
		assert.equal(await (await store.loadMediaAsset('shared-id')).text(), winner);
		if (indexedDB) assert.equal(indexedDB.recordCount(databaseName, 'mediaAssets'), 1);
		if (backend === 'opfs-model') {
			assert.equal(fulfilled[0].value.storage, 'indexeddb-blob', 'a structural directory cannot grant native path custody');
			assert.equal(files.size, 0, 'no witnessless model path may be created');
		}
	});
}

for (const backend of ['memory', 'indexeddb', 'opfs-model']) {
	test(`${backend} retained-media digests use the Blob's stored bytes instead of overridden readers`, async context => {
		const files = new Map();
		const indexedDB = backend === 'memory' ? null : createInstrumentedIndexedDB();
		const sourceDirectory = createOpfsDirectory(files);
		const databaseName = uniqueDatabaseName(`adversarial-media-${backend}`);
		const store = createProjectStore({
			indexedDB,
			memoryFallback: backend === 'memory',
			preferOpfs: backend === 'opfs-model',
			databaseName,
			storageManager: backend === 'opfs-model' ? {
				async getDirectory() { return { async getDirectoryHandle() { return sourceDirectory; } }; },
			} : null,
		});
		context.after(() => store.close());
		const input = new LyingBlob('original-video', 'forged-content', { type: 'video/webm' });

		const metadata = await store.writeMediaAsset('adversarial-media', input);
		const loaded = await store.loadMediaAsset('adversarial-media');

		assert.equal(metadata.sha256, 'ddc5852cf5d92b542ec7d6efcc6d9c02a53f9692fd5f36e954896c21c7a8ac4e');
		assert.equal(await loaded.text(), 'original-video');
		if (backend === 'memory') {
			assert.equal(await store.memory.mediaAssets.get('adversarial-media').blob.text(), 'original-video');
		} else {
			assert.equal(await indexedDB.records(databaseName, 'mediaAssets')[0].blob.text(), 'original-video');
			if (backend === 'opfs-model') {
				assert.equal(metadata.storage, 'indexeddb-blob', 'the model handle is insufficient for native OPFS publication');
				assert.equal(files.size, 0);
			}
		}
	});
}

test('media-only sources participate in project retention and cascade on source deletion', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('media-retention'),
	});
	await store.writeMediaAsset('retained-video', new Blob(['video']));
	await store.saveVideoDerivative('retained-video', {
		timestamp: 0,
		type: 'poster',
		blob: new Blob(['poster']),
	});
	await store.saveProject({
		id: 'video-project',
		schemaFamily: 'framescaper',
		schemaVersion: 1,
		revision: 1,
		updatedAt: '2026-07-18T00:00:00.000Z',
		sources: [{ id: 'retained-video' }],
		clips: [{ id: 'video-clip', sourceId: 'retained-video' }],
		videoMotionAnalyses: [],
		videoVisualPresentations: [],
		videoFinishingPresets: [],
	});

	assert.equal((await store.getMediaAssetMetadata('retained-video')).pendingProjectUntil, undefined);
	let result = await store.pruneUnreferencedSources({
		minimumAgeMs: 0,
		now: Date.now() + 2 * 24 * 60 * 60 * 1000,
	});
	assert.deepEqual(result.deletedSourceIds, []);

	await store.deleteProject('video-project');
	result = await store.pruneUnreferencedSources({
		minimumAgeMs: 0,
		now: Date.now() + 2 * 24 * 60 * 60 * 1000,
	});
	assert.deepEqual(result.deletedSourceIds, ['retained-video']);
	assert.equal(await store.loadMediaAsset('retained-video'), null);
	assert.deepEqual(await store.listVideoDerivatives('retained-video'), []);

	await store.writeMediaAsset('media-only', new Blob(['video']));
	await store.saveVideoDerivative('media-only', {
		timestamp: 10,
		type: 'thumbnail',
		blob: new Blob(['ten']),
	});
	await store.deleteSource('media-only');
	assert.equal(await store.getMediaAssetMetadata('media-only'), null);
	assert.deepEqual(await store.listVideoDerivatives('media-only'), []);
});

test('Framescaper image-sequence retention follows clip reachability for both bodies', async () => {
	const packSha256 = '4862f447f2c7f272fa2f4aaf89dadb3b1ac09105bd5864f8d1a0c9452bb0a226';
	const inventorySha256 = 'b11a85b296a90afc460430434a504e7acb04b064575b7277724688af0e59d189';
	const packStorageKey = `image-sequence-pack-sha256:${packSha256}`;
	const inventoryStorageKey = `image-sequence-inventory-sha256:${inventorySha256}`;
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('image-sequence-retention'),
	});
	await store.writeMediaAsset(packStorageKey, new Blob(['pack']));
	await store.writeMediaAsset(inventoryStorageKey, new Blob(['inventory']));
	const project = {
		id: 'image-sequence-project',
		schemaFamily: 'framescaper',
		schemaVersion: 1,
		revision: 1,
		updatedAt: '2026-08-30T00:00:00.000Z',
		sources: [{
			kind: 'video',
			id: 'image-sequence-source',
			name: 'Image sequence',
			storageKey: packStorageKey,
			contentSha256: packSha256,
			imageSequence: {
				kind: 'video',
				sourceType: 'image-sequence',
				version: 1,
				id: 'image-sequence-source',
				name: 'Image sequence',
				stem: 'frame_',
				extension: 'png',
				frameNumberWidth: 4,
				firstFrameNumber: 1,
				lastFrameNumber: 1,
				frameCount: 1,
				frameRate: { num: 24, den: 1 },
				inventory: {
					kind: 'image-sequence-inventory',
					version: 1,
					storageKey: inventoryStorageKey,
					sha256: inventorySha256,
					byteLength: 9,
					frameCount: 1,
					firstFrameNumber: 1,
					lastFrameNumber: 1,
				},
				sourcePack: {
					kind: 'image-sequence-source-pack',
					storageKey: packStorageKey,
					sha256: packSha256,
					byteLength: 4,
				},
				characteristics: {},
			},
		}],
		clips: [{ id: 'image-sequence-clip', sourceId: 'image-sequence-source' }],
		videoMotionAnalyses: [],
		videoVisualPresentations: [],
		videoFinishingPresets: [],
	};
	await store.saveProject(project);

	assert.equal((await store.getMediaAssetMetadata(packStorageKey)).pendingProjectUntil, undefined);
	assert.equal((await store.getMediaAssetMetadata(inventoryStorageKey)).pendingProjectUntil, undefined);
	let result = await store.pruneUnreferencedSources({
		minimumAgeMs: 0,
		now: Date.now() + 2 * 24 * 60 * 60 * 1000,
	});
	assert.deepEqual(result.deletedSourceIds, []);
	assert.equal(await (await store.loadMediaAsset(packStorageKey)).text(), 'pack');
	assert.equal(await (await store.loadMediaAsset(inventoryStorageKey)).text(), 'inventory');

	await store.deleteProject(project.id);
	result = await store.pruneUnreferencedSources({
		protectedProjects: [{ ...project, clips: [] }],
		minimumAgeMs: 0,
		now: Date.now() + 2 * 24 * 60 * 60 * 1000,
	});
	assert.deepEqual(
		[...result.deletedSourceIds].sort(),
		[inventoryStorageKey, packStorageKey].sort(),
	);
	assert.equal(await store.loadMediaAsset(packStorageKey), null);
	assert.equal(await store.loadMediaAsset(inventoryStorageKey), null);
});

test('deleting a media asset leaves PCM intact while deleting its media derivatives', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('media-pcm'),
	});
	const writer = await store.beginSourceWrite('shared-source', { sampleRate: 48_000 });
	await writer.write([Float32Array.of(0.25, 0.5)]);
	await writer.commit();
	await store.writeMediaAsset('shared-source', new Blob(['container']));
	await store.saveVideoDerivative('shared-source', {
		timestamp: 0,
		type: 'poster',
		blob: new Blob(['poster']),
	});

	await store.deleteMediaAsset('shared-source');

	assert.equal(await store.getMediaAssetMetadata('shared-source'), null);
	assert.deepEqual(await store.listVideoDerivatives('shared-source'), []);
	assert.equal((await store.getSourceMetadata('shared-source')).frameCount, 2);
	assert.deepEqual([...((await store.readSourceChunk('shared-source', 0)).channels[0])], [0.25, 0.5]);
});

test('derivative cache trimming reports exact disposal while preserving durable project media and PCM', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('derivative-cache-memory'),
	});
	const writer = await store.beginSourceWrite('cache-source', { sampleRate: 48_000 });
	await writer.write([Float32Array.of(0.25, 0.5)]);
	await writer.commit();
	await store.writeMediaAsset('cache-source', new Blob(['immutable-container']));
	await store.saveProject({
		id: 'cache-project',
		revision: 1,
		updatedAt: '2026-07-28T00:00:00.000Z',
		sources: [{ id: 'cache-source' }],
		clips: [],
	});
	const first = await store.saveVideoDerivative('cache-source', {
		timestamp: 0,
		type: 'poster',
		blob: new Blob(['poster']),
	});
	await store.saveVideoDerivative('cache-source', {
		timestamp: 1,
		type: 'thumbnail',
		blob: new Blob(['thumbnail']),
	});
	assert.equal('cacheToken' in first, false, 'internal compare-and-delete tokens are not public metadata');

	const report = await store.trimVideoDerivativeCache({ maximumBytes: 0, maximumEntries: 0 });

	assert.deepEqual(report.before, { bytes: 15, entries: 2 });
	assert.deepEqual(report.after, { bytes: 0, entries: 0 });
	assert.equal(report.removedBytes, 15);
	assert.equal(report.removedEntries, 2);
	assert.equal(report.skippedEntries, 0);
	assert.equal(report.satisfied, true);
	assert.deepEqual(await store.listVideoDerivatives('cache-source'), []);
	assert.equal(await (await store.loadMediaAsset('cache-source')).text(), 'immutable-container');
	assert.equal((await store.getSourceMetadata('cache-source')).frameCount, 2);
	assert.equal((await store.loadProject('cache-project')).id, 'cache-project');
});

test('OPFS PCM and derivative models coexist with witnessless media fallback and exact cascades', async context => {
	const files = new Map();
	const sourceDirectory = createOpfsDirectory(files);
	const root = { async getDirectoryHandle() { return sourceDirectory; } };
	const store = createProjectStore({
		indexedDB: createInstrumentedIndexedDB(), memoryFallback: false,
		databaseName: uniqueDatabaseName('media-opfs'),
		storageManager: { async getDirectory() { return root; } },
	});
	context.after(() => store.close());
	const writer = await store.beginSourceWrite('opfs-media', { sampleRate: 48_000 });
	await writer.write([Float32Array.of(0.5)]);
	await writer.commit();
	const media = await store.writeMediaAsset('opfs-media', new Blob(['container'], { type: 'video/mp4' }), {
		sha256: 'A42D519714D616E9411DBCEEC4B52808BD6B1EE53E6F6497A281D655357D8B71',
	});
	const derivative = await store.saveVideoDerivative('opfs-media', {
		timestamp: 5,
		type: 'thumbnail',
		blob: new Blob(['thumbnail'], { type: 'image/webp' }),
	});

	assert.equal(media.storage, 'indexeddb-blob', 'the structural directory grants no whole-Blob custody');
	assert.equal(media.sha256, 'a42d519714d616e9411dbceec4b52808bd6b1ee53e6f6497a281d655357d8b71');
	assert.equal(derivative.storage, 'opfs');
	assert.equal(files.size, 2, 'only the PCM and derivative model files exist');
	const loadedMedia = await store.loadMediaAsset('opfs-media');
	assert.equal(await loadedMedia.text(), 'container');
	assert.equal(loadedMedia.type, 'video/mp4');
	assert.equal(
		await (await store.loadVideoDerivative('opfs-media', { timestamp: 5, type: 'thumbnail' })).text(),
		'thumbnail',
	);

	await store.deleteMediaAsset('opfs-media');
	assert.equal(files.size, 1, 'the PCM file remains after deleting only the media asset');
	assert.equal((await store.getSourceMetadata('opfs-media')).storage, 'opfs-pcm-v1');
	await store.deleteSource('opfs-media');
	assert.equal(files.size, 0);
});

test('derivative cache trimming removes only derivative OPFS model blobs', async context => {
	const files = new Map();
	const sourceDirectory = createOpfsDirectory(files);
	const root = { async getDirectoryHandle() { return sourceDirectory; } };
	const store = createProjectStore({
		indexedDB: createInstrumentedIndexedDB(), memoryFallback: false,
		databaseName: uniqueDatabaseName('derivative-cache-opfs'),
		storageManager: { async getDirectory() { return root; } },
	});
	context.after(() => store.close());
	const writer = await store.beginSourceWrite('opfs-cache', { sampleRate: 48_000 });
	await writer.write([Float32Array.of(0.5)]);
	await writer.commit();
	await store.writeMediaAsset('opfs-cache', new Blob(['container']));
	await store.saveVideoDerivative('opfs-cache', {
		timestamp: 0,
		type: 'poster',
		blob: new Blob(['poster']),
	});
	await store.saveVideoDerivative('opfs-cache', {
		timestamp: 1,
		type: 'thumbnail',
		blob: new Blob(['thumbnail']),
	});
	assert.equal(files.size, 3, 'PCM and both derivatives use the model; the original is an IndexedDB Blob');

	await store.trimVideoDerivativeCache({ maximumBytes: 0, maximumEntries: 0 });

	assert.equal(files.size, 1, 'only the canonical PCM model file remains; the immutable container stays in IndexedDB');
	assert.equal(await (await store.loadMediaAsset('opfs-cache')).text(), 'container');
	assert.equal((await store.getSourceMetadata('opfs-cache')).frameCount, 1);
});

test('cancelled witnessless OPFS media reads join without creating files or publishing metadata', { timeout: 15_000 }, async context => {
	const files = new Map(), controller = new AbortController(), reason = new DOMException('cancel media', 'AbortError');
	let releaseRead, markStarted, refuseStarted;
	const gate = new Promise(resolve => { releaseRead = resolve; });
	const started = new Promise((resolve, reject) => { markStarted = resolve; refuseStarted = reject; });
	const sourceDirectory = createOpfsDirectory(files, { onWrite() { assert.fail('A witnessless direct write must never create a model file.'); } });
	const databaseName = uniqueDatabaseName('cancel-media-opfs'), indexedDB = createInstrumentedIndexedDB();
	const store = createProjectStore({ indexedDB, memoryFallback: false, databaseName,
		storageManager: { async getDirectory() { return { async getDirectoryHandle() { return sourceDirectory; } }; } } });
	const nativeRead = Blob.prototype.arrayBuffer;
	Blob.prototype.arrayBuffer = async function () { const bytes = await nativeRead.call(this); markStarted(); await gate; return bytes; };
	const stop = () => { controller.abort(context.signal.reason ?? reason); releaseRead(); refuseStarted(context.signal.reason ?? reason); };
	context.signal.addEventListener('abort', stop, { once: true });
	let deadlineExpired = false;
	const timer = setTimeout(() => { deadlineExpired = true; stop(); }, 13_000);
	let write, observing;
	try {
		write = store.writeMediaAsset('cancelled-media', new Blob(['unpublished']), {}, { signal: controller.signal });
		observing = write.then(() => { refuseStarted(new Error('Native digest barrier was skipped.')); }, refuseStarted);
		await started;
		let settled = false; void write.then(() => { settled = true; }, () => { settled = true; });
		controller.abort(reason); await Promise.resolve(); assert.equal(settled, false, 'cancellation must join the actual held native read');
		releaseRead(); await assert.rejects(write, error => error === reason);
		assert.equal(await store.getMediaAssetMetadata('cancelled-media'), null);
		assert.equal(indexedDB.recordCount(databaseName, 'mediaAssets'), 0); assert.equal(files.size, 0);
	} finally {
		stop(); await Promise.allSettled([write, observing]); Blob.prototype.arrayBuffer = nativeRead;
		context.signal.removeEventListener('abort', stop); clearTimeout(timer); await store.close();
	}
	assert.equal(deadlineExpired, false, 'the forced cleanup deadline can never be a passing cancellation');
});

test('pre-publication cancellation publishes neither memory nor IndexedDB media metadata', async () => {
	for (const backend of ['memory', 'indexeddb']) {
		const controller = new AbortController();
		const reason = new DOMException(`cancel ${backend} media publication`, 'AbortError');
		const indexedDB = backend === 'indexeddb' ? createInstrumentedIndexedDB() : null;
		const databaseName = uniqueDatabaseName(`cancel-media-${backend}`);
		const store = createProjectStore({
			indexedDB,
			memoryFallback: backend === 'memory',
			preferOpfs: false,
			databaseName,
		});
		const write = store.writeMediaAsset(
			'cancelled-digest',
			new Blob([`unpublished-${backend}`]),
			{},
			{ signal: controller.signal },
		);
		controller.abort(reason);

		await assert.rejects(
			write,
			(error) => error === reason,
		);
		assert.equal(await store.getMediaAssetMetadata('cancelled-digest'), null);
		assert.equal(store.memory.mediaAssets.size, 0);
		if (indexedDB) assert.equal(indexedDB.recordCount(databaseName, 'mediaAssets'), 0);
	}
});

test('media cancellation after the publication boundary resolves the committed metadata', async () => {
	const controller = new AbortController();
	const reason = new DOMException('late media cancellation', 'AbortError');
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueDatabaseName('committed-media-cancellation'),
	});
	const publish = store.memory.mediaAssets.set.bind(store.memory.mediaAssets);
	store.memory.mediaAssets.set = (key, value) => {
		const result = publish(key, value);
		controller.abort(reason);
		return result;
	};

	const metadata = await store.writeMediaAsset(
		'committed-media',
		new Blob(['committed']),
		{},
		{ signal: controller.signal },
	);

	assert.equal(metadata.sha256, 'cc962289af2873dd6dad32931554372a7d2d2de5bd5859c8265eb58b5197a88e');
	assert.deepEqual(await store.getMediaAssetMetadata('committed-media'), metadata);
});

function uniqueDatabaseName(prefix) {
	return `${prefix}-${Date.now()}-${Math.random()}`;
}
