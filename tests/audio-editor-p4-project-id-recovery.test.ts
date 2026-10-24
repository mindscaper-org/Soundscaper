/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { RecordingRecoveryJournalRepository } from '../src/common/editor/storage/recording-recovery-journal-repository.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import type { RecordingControllerFactoryOptions } from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import { createRecordingCapturePool, createMockStream, createMockTrack, createRecordingEngine,
	createRecordingControllerFactory } from './helpers/audio-editor-recording-controller-harness.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { decodeProjectIdKey, encodeProjectIdKey } from '../src/common/editor/project-validation-primitives.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import type { RawPcmSpoolRepository } from '../src/common/editor/storage/raw-pcm-spool-repository.ts';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const id of ['padded', ' padded ', 'e\u0301', '\ud800']) {
	test(`native project ${JSON.stringify(id)} completes automatic recovery inspection and stays writable`, async context => {
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		});
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		const project = createSoundscaperProject({ id }); await store.saveProject(project);
		await controller.actions.project.openById(id);
		assert.equal(controller.project?.id, id);
		assert.equal(controller.getSnapshot().readOnly, false);
		assert.equal(controller.getSnapshot().takeCycleRecovery, null);
	});

	test(`ordinary recording journals preserve authored project identity ${JSON.stringify(id)}`, async context => {
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		context.after(async () => { await store.close(); });
		const repository = new RecordingRecoveryJournalRepository(store.analysisRepository);
		const base = createSoundscaperProject({ id });
		const journal = await repository.create(id, 'capture', base);
		assert.deepEqual(await repository.load(id), journal);
		for (const other of [id === 'padded' ? ' padded ' : 'padded', id.normalize('NFC') + '%20']) {
			assert.equal(await repository.load(other), null, 'distinct authored identities never alias a recovery journal');
		}
		await repository.remove(journal); assert.equal(await repository.load(id), null);
	});

	test(`project generation authority retains exact authored identity ${JSON.stringify(id)}`, () => {
		const generation = new EditorProjectGeneration(); generation.activate(id);
		assert.equal(generation.capture(id).projectId, id);
		const old = generation.capture(id); generation.activate(id === 'padded' ? ' padded ' : 'padded');
		assert.throws(() => generation.assertCurrent(old), { name: 'AbortError' });
	});

	test(`actual recording and durable Save preserve authored project ${JSON.stringify(id)}`, async context => {
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const runtime = createSoundscaperProjectRuntimeSelection(), created: RecordingControllerFactoryOptions[] = [];
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			engine: createRecordingEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
			recordingCapturePool: createRecordingCapturePool({ requestHardwareInput: async () => createMockStream([createMockTrack('audio', { channelCount: 1 })]) }),
			recordingControllerFactory: createRecordingControllerFactory(created),
		});
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		await store.saveProject(createSoundscaperProject({ id, tracks: [createAudioTrack({ id: 'voice', name: 'Voice', armed: true })] }));
		await controller.actions.project.openById(id);
		await controller.actions.recording.start({ trackId: 'voice' });
		const recorder = created[0]; assert.ok(recorder);
		await recorder.onChunk({ frameStart: 0, frames: 128, channels: [new Float32Array(128).fill(.25)] });
		await controller.actions.recording.stop();
		const source = controller.project?.sources[0]; assert.ok(source);
		const stored = await store.readSourceChunk(source.storageKey, 0);
		assert.deepEqual([...stored.channels[0]!], Array<number>(128).fill(.25));
		assert.equal((await store.loadProject(id))?.id, id);
		assert.equal(await new RecordingRecoveryJournalRepository(store.analysisRepository).load(id), null);
	});
}

test('project key encoding preserves legacy URI bytes and separates literal escapes from UTF-16 units', () => {
	for (const id of ['plain', ' padded ', 'e\u0301', '%ud800', '\\ud800', '🎵/:\u0000']) {
		assert.equal(encodeProjectIdKey(id), encodeURIComponent(id));
	}
	const ids = ['\ud800', '\udfff', '\ud800\udfff', '\ud800%ud800', '%ud800', '\\ud800'];
	assert.equal(new Set(ids.map(encodeProjectIdKey)).size, ids.length);
	for (const id of ids) assert.equal(decodeProjectIdKey(encodeProjectIdKey(id)), id);
});

for (const backend of ['memory', 'indexeddb'] as const) test(`${backend} raw capture ownership preserves exact logical IDs and refuses stale writes`, async context => {
	const store = createProjectStore({ indexedDB: backend === 'memory' ? null : createInstrumentedIndexedDB(), preferOpfs: false, databaseName: context.name });
	context.after(async () => { await store.close(); }); await store.ready();
	const spools = store.rawPcmSpoolRepository as RawPcmSpoolRepository;
	for (const id of ['padded', ' padded ', 'e\u0301', 'é', '\ud800', '%ud800']) {
		assert.equal(await spools.allocateGeneration(id), 1);
		const before = await spools.create({ projectId: id, spoolId: 'capture', sampleRate: 48_000, channelCount: 1, chunkFrames: 128, data: {} });
		const next = await spools.append(before, [Float32Array.of(.125, -.25)], {});
		await assert.rejects(spools.append(before, [Float32Array.of(.5)], {}), /changed/u);
		assert.deepEqual((await spools.list(id)).map(record => record.projectId), [id]);
		assert.deepEqual([...(await spools.chunk(next, 0)).channels[0]!], [.125, -.25]);
	}
	assert.deepEqual((await spools.listAll()).map(record => record.projectId).sort(), ['padded', ' padded ', 'e\u0301', 'é', '\ud800', '%ud800'].sort());
	const inventory = await store.analysisRepository.listByPrefix('raw-pcm-spool-registry-v1:');
	assert.deepEqual(inventory.map(record => record.projectId).sort(), ['padded', ' padded ', 'e\u0301', 'é', '\ud800', '%ud800'].sort());
	await store.analysisRepository.put('malformed-key-control:%E0%A4%A', {});
	assert.equal((await store.analysisRepository.listByPrefix('malformed-key-control:'))[0]?.projectId, '%E0%A4%A');
	await store.analysisRepository.delete('raw-pcm-spool-global-inventory-v1');
	const afterRebuiltInventory = await spools.create({ projectId: 'next', spoolId: 'capture', sampleRate: 48_000, channelCount: 1, chunkFrames: 128, data: {} });
	assert.equal(afterRebuiltInventory.projectId, 'next');
	assert.equal((await spools.listAll()).length, 7);
	await assert.rejects(spools.create({ projectId: ' padded ', spoolId: ' bad ', sampleRate: 48_000, channelCount: 1, chunkFrames: 128, data: {} }), /invalid/u);
});
