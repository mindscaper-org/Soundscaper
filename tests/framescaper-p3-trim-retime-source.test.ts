/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { TrimMediaFfmpegRuntime } from '../src/common/editor/controller/document/trim-media-service.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperProject, validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { createAudioEditorController } from '../src/common/editor/app.js';
import { createVideoSource, createVideoClip, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { COPY, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import type { VideoRetimeCurveV16 } from '../src/common/editor/video-retime-v16.ts';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
type Mode = 'forward' | 'reverse' | 'ramp';

for (const mode of ['forward', 'reverse', 'ramp'] as const) for (const bin of [false, true]) {
	test(`File Trim preserves the ${mode} curve in ${bin ? 'timeline and Bin' : 'timeline'}`, async context => {
		const { controller, store } = await fixture(context, mode, bin);
		const before = controller.project; assert.ok(before);
		const result = await controller.actions.media.trim();
		assert.ok(result); assert.equal(result.complete, true, JSON.stringify(result.report));
		assert.equal(result.run.trimmedSources, 1);
		const after: unknown = controller.project; assert.ok(validateFramescaperProject(PROFILE, after));
		const clips = records(after.clips);
		const placed = clips.find(clip => clip.id === 'clip'); assert.ok(placed);
		// Every frame is a keyframe in the deterministic copy lease. The first
		// retained run starts at source123; a later Bin run has a different offset.
		assert.equal(placed.sourceInFrame, 0);
		assert.deepEqual(placed.retimeMap, curve(mode, 0));
		assert.equal(placed.sequenceStartFrame, 0); assert.equal(placed.sequenceFrameCount, 60);
		if (bin) {
			const binClips = record(after.projectBin).clips;
			const retained = records(binClips).find(clip => clip.id === 'bin'); assert.ok(retained);
			assert.equal(retained.sourceInFrame, 60);
			assert.deepEqual(retained.retimeMap, curve(mode, 60));
		}
		const source = records(after.sources).find(source => source.id === placed.sourceId); assert.ok(source);
		const original = records(before.sources).find(source => source.id === placed.sourceId); assert.ok(original);
		assert.notEqual(source.storageKey, original.storageKey);
		assert.equal(source.sourceFrameCount, bin ? 120 : 60);
		assert.ok(typeof source.storageKey === 'string');
		const body = await store.loadMediaAsset(source.storageKey); assert.ok(body);
		assert.deepEqual(new Uint8Array(await body.arrayBuffer()), Uint8Array.of(4, 5, 6));
		controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before.clips);
		assert.deepEqual(controller.project?.sources, before.sources);
		assert.deepEqual(controller.project?.projectBin, before.projectBin);
		controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, after.clips);
		assert.deepEqual(controller.project?.projectBin, after.projectBin);
		const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(after, store);
		assert.ok(archive.blob instanceof Blob, 'the conformed curve remains portable');
	});
}

function curve(mode: Mode, start: number): VideoRetimeCurveV16 {
	return { feature: 'video-retime', version: 2, points: [
		{ outerFrame: 0, sourceFrame: { num: mode === 'reverse' ? start + 60 : start, den: 1 } },
		...(mode === 'forward' ? [{ outerFrame: 30, sourceFrame: { num: start * 2 + 61, den: 2 } }] : []),
		{ outerFrame: 60, sourceFrame: { num: mode === 'reverse' ? start : start + 60, den: 1 } },
	], segments: mode === 'forward' ? [{ mode: 'constant-forward' }, { mode: 'constant-forward' }] : [mode === 'ramp' ? { mode: 'ramp-forward', startVelocity: { num: 1, den: 2 }, endVelocity: { num: 3, den: 2 } }
		: { mode: mode === 'reverse' ? 'constant-reverse' : 'constant-forward' }] };
}

async function fixture(context: TestContext, mode: Mode, bin: boolean) {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }), persisted: async () => true,
			persist: async () => true } as unknown as StorageManager,
	} });
	const store = environment.store;
	const controller = createAudioEditorController(null, { headless: true, productId: 'framescaper', copy: COPY, locale: 'en',
		store: environment.controllerStore, projectRuntime: environment.runtime,
		sessionController: environment.runtime.createSessionController(), acquireProjectLock: environment.runtime.acquireProjectLock,
		playbackProjectService: environment.playback, scapeProjectRuntime: createFramescaperScapeNativeRuntime(PROFILE),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: copyLease() as unknown as Options['ffmpeg'],
	});
	context.after(async () => { await controller.dispose(); await environment.close(); }); await controller.ready;
	const sequence = { id: 'main', rate: { num: 30, den: 1 } };
	const source = createVideoSource({ id: 'video', storageKey: 'video', mimeType: 'video/mp4', name: 'Original.mp4',
		frameCount: 480_000, sampleRate: 48_000, sourceFrameCount: 300, frameRate: sequence.rate, width: 640, height: 360,
		videoCodec: 'h264', audioCodec: null, hasAudio: false,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: sequence.rate, reason: 'timing-probe-unavailable', failures: [] },
	});
	const clip = createVideoClip({ id: 'clip', sourceId: source.id, sequenceId: sequence.id, sequenceStartFrame: 0,
		sequenceFrameCount: 60, sourceInFrame: 123, sourceFrameCount: 60 }, { projectSampleRate: 48_000, sequence, source });
	const project = createFramescaperProject(PROFILE, { id: `retimed-trim-${mode}-${String(bin)}`, sequences: [sequence],
		primarySequenceId: sequence.id, sources: [source], clips: [{ ...clip, retimeMap: curve(mode, 123) }],
		tracks: [createVideoTrack({ id: 'video-track', sequenceId: sequence.id, clipIds: ['clip'] })],
		projectBin: { clips: bin ? [{ ...clip, id: 'bin', binItemId: 'bin', sourceInFrame: 240, retimeMap: curve(mode, 240) }] : [] },
	});
	await store.writeMediaAsset('video', new Blob([Uint8Array.of(1, 2, 3)], { type: 'video/mp4' }), { mimeType: 'video/mp4' });
	const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store);
	assert.ok(archive.blob instanceof Blob);
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Original.fscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	return { controller, store };
}

function copyLease() {
	return { ...createMemoryFfmpeg(), async runTrimMediaOperation<T>(operation: (lease: TrimMediaFfmpegRuntime) => Promise<T>) {
		return operation({ async writeInput() { return 'input'; }, async writeText() {},
			async exec(args) { return args.some(argument => argument.includes('showinfo'))
				? { exitCode: 0, logs: Array.from({ length: 300 }, (_, frame) => `[Parsed_showinfo_0 @ 0x1] n:${String(frame)} pts:${String(frame)} iskey:1`) }
				: { exitCode: 0, logs: [] }; },
			async readOutput() { return Uint8Array.of(4, 5, 6); }, async deletePath() {},
		});
	} };
}
function record(value: unknown): Readonly<Record<string, unknown>> {
	assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
	return value as Readonly<Record<string, unknown>>;
}
function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	assert.ok(Array.isArray(value)); return (value as unknown[]).map(record);
}
