/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { createAudioEditorController } from '../src/common/editor/app.js';
import { createVideoSource, createVideoClip, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import type { TrimMediaFfmpegRuntime } from '../src/common/editor/controller/document/trim-media-service.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { p3TrimPreviewVideo } from './helpers/p3-trim-preview-video.ts';
import { COPY, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg, waitFor } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
test('P3-015: Trim media, Undo and Redo present the bytes belonging to the current native video source', async context => {
	const { bytes: original, core } = await p3TrimPreviewVideo();
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }), persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const store = environment.store, native = createFramescaperScapeNativeRuntime(PROFILE);
	const ffmpeg = { ...createMemoryFfmpeg(), async runTrimMediaOperation<T>(operation: (lease: TrimMediaFfmpegRuntime) => Promise<T>) {
		return operation({
			async writeInput(bytes) { core.FS.writeFile('trim-input.mp4', bytes); return 'trim-input.mp4'; },
			async writeText(path, text) { core.FS.writeFile(path, text); },
			async exec(args) { const logs: string[] = []; core.setLogger(({ message }) => { logs.push(message); }); return { exitCode: core.exec(...args), logs }; },
			async readOutput(path) { return Uint8Array.from(core.FS.readFile(path)); },
			async deletePath(path) { core.FS.unlink(path); },
		});
	} };
	const controller = createAudioEditorController(null, { headless: true, productId: 'framescaper', copy: COPY, locale: 'en',
		store: environment.controllerStore, projectRuntime: environment.runtime, sessionController: environment.runtime.createSessionController(),
		acquireProjectLock: environment.runtime.acquireProjectLock, playbackProjectService: environment.playback, scapeProjectRuntime: native,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: ffmpeg as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready;
	const sequence = { id: 'main', rate: { num: 25, den: 1 } };
	const source = createVideoSource({ id: 'four-colours', storageKey: 'four-colours', mimeType: 'video/mp4', name: 'Four colours.mp4',
		frameCount: 192_000, sampleRate: 48_000, sourceFrameCount: 100, frameRate: sequence.rate, width: 64, height: 32,
		videoCodec: 'h264', audioCodec: null, hasAudio: false,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: sequence.rate, reason: 'timing-probe-unavailable', failures: [] } });
	const clip = createVideoClip({ id: 'blue', sourceId: source.id, sequenceId: sequence.id, sequenceStartFrame: 0,
		sequenceFrameCount: 25, sourceInFrame: 50, sourceFrameCount: 25 }, { projectSampleRate: 48_000, sequence, source });
	const project = createFramescaperProject(PROFILE, { id: 'trim-preview-media', sequences: [sequence], primarySequenceId: sequence.id,
		sources: [source], clips: [clip], tracks: [createVideoTrack({ id: 'video-track', sequenceId: sequence.id, clipIds: [clip.id] })] });
	await store.writeMediaAsset(source.storageKey, new Blob([original], { type: source.mimeType }), { mimeType: source.mimeType });
	const archive = await native.exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Blue.fscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	const opened = controller.project; assert.ok(opened);
	const openedSource = opened.sources.find(item => item.kind === 'video'); assert.ok(openedSource);
	const previewBytes = async () => {
		const visual = controller.actions.video.getSourceVisualData(openedSource.id);
		assert.ok(visual?.mediaUrl);
		return new Uint8Array(await (await fetch(visual.mediaUrl)).arrayBuffer());
	};
	assert.deepEqual(await previewBytes(), original);
	const result = await controller.actions.media.trim();
	assert.equal(result?.run.trimmedSources, 1, JSON.stringify(result?.report));
	const key = result?.run.sources.find(item => item.sourceId === openedSource.id)?.storageKey; assert.ok(key);
	const trimmed = await store.loadMediaAsset(key); assert.ok(trimmed);
	const expected = new Uint8Array(await trimmed.arrayBuffer()); assert.notDeepEqual(expected, original);
	await waitFor(() => controller.actions.video.getSourceVisualData(openedSource.id)?.mediaUrl !== null);
	assert.deepEqual(await previewBytes(), expected, 'the source in-point is now zero, so retaining the original URL would show red instead of blue');
	controller.actions.edit.undo();
	await waitFor(() => controller.actions.video.getSourceVisualData(openedSource.id)?.mediaUrl !== null);
	assert.deepEqual(await previewBytes(), original);
	controller.actions.edit.redo();
	await waitFor(() => controller.actions.video.getSourceVisualData(openedSource.id)?.mediaUrl !== null);
	assert.deepEqual(await previewBytes(), expected);
});
