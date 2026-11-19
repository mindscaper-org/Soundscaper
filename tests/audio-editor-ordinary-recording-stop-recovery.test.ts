/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import type { RecordingControllerFactory, RecordingControllerFactoryOptions } from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import type { RecordingCaptureControllerLike } from '../src/common/editor/controller/recording/internal/recording-session-service.ts';
import type { ClockedPlaybackStartHook } from '../src/common/editor/engine/clocked-playback-start.ts';
import { RECORDING_RECOVERY_KEY_PREFIX, RecordingRecoveryJournalRepository } from '../src/common/editor/storage/recording-recovery-journal-repository.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import {
	createAudioEditorController, createCapturePool, createFfmpegStub,
	createMockStream, createMockTrack, createRecordingControllerFactory, createRecordingEngine,
} from './helpers/audio-editor-recording-controller-harness.js';

test('public Stop joins pending ordinary journal creation before abandoning it and cannot start late capture', { timeout: 10_000 }, async context => {
	const fixture = await createFixture(context);
	const preparation = fixture.gate();
	const values = fixture.store.analysisRepository;
	const putIfAbsent = values.putIfAbsent.bind(values);
	values.putIfAbsent = async (key, value) => {
		const created = await putIfAbsent(key, value);
		if (key.startsWith(RECORDING_RECOVERY_KEY_PREFIX)) {
			preparation.enter();
			await preparation.wait;
		}
		return created;
	};
	const started = fixture.track(fixture.controller.actions.recording.start({ trackId: fixture.trackId }));
	await assertEntered(preparation.entered, started, 'ordinary start must reach durable journal creation');
	assert.ok(await fixture.journal(), 'the durable journal exists while its begin operation is still pending');
	assert.equal(fixture.controller.getSnapshot().recording, false);
	assert.equal(fixture.created.length, 0);
	let stopSettled = false;
	const stopped = fixture.track(fixture.controller.actions.transport.stop()).then(result => {
		stopSettled = true;
		return result;
	});
	await setImmediate();
	const settledBeforeBegin = stopSettled;
	preparation.release();
	const [startResult, stopResult] = await Promise.all([started, stopped]);

	assert.equal(settledBeforeBegin, false, 'Stop must join journal preparation before reporting cancellation complete');
	assert.equal(stopResult.status, 'fulfilled');
	assertCanceledStart(startResult);
	assert.equal(fixture.created.length, 0, 'the canceled start cannot create a recorder after journal preparation finishes');
	assert.equal(fixture.controller.getSnapshot().recording, false);
	assert.equal(await fixture.journal(), null, 'Stop settles the journal created by its pending start');
	assert.equal((await fixture.store.listSources()).length, 0);
});

test('public Stop joins owned journal removal when routed context preparation is canceled', { timeout: 10_000 }, async context => {
	const fixture = await createFixture(context, { freshInputs: true });
	const preparation = fixture.gate();
	const removal = fixture.gate();
	await fixture.controller.actions.recording.setTrackInput(fixture.trackId, {
		kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 1,
	});
	const getAudioContext = fixture.engine.getAudioContext.bind(fixture.engine);
	fixture.engine.getAudioContext = async () => {
		preparation.enter();
		await preparation.wait;
		return getAudioContext();
	};
	const values = fixture.store.analysisRepository;
	const deleteIfCurrent = values.deleteIfCurrent.bind(values);
	values.deleteIfCurrent = async (key, expected) => {
		if (key.startsWith(RECORDING_RECOVERY_KEY_PREFIX)) {
			removal.enter();
			await removal.wait;
		}
		return deleteIfCurrent(key, expected);
	};
	const started = fixture.track(fixture.controller.actions.recording.start({ trackId: fixture.trackId }));
	await assertEntered(preparation.entered, started, 'routed start must reach audio context preparation', removal.entered);
	assert.ok(await fixture.journal());
	assert.equal(fixture.created.length, 0, 'routed capture is still preparing its audio context');
	const capturingInput = fixture.inputs.at(-1);
	assert.ok(capturingInput);
	assert.equal(capturingInput.getAudioTracks()[0]!.readyState, 'live');
	let stopSettled = false;
	const stopped = fixture.track(fixture.controller.actions.transport.stop()).then(result => {
		stopSettled = true;
		return result;
	});
	preparation.release();
	await assertEntered(removal.entered, started, 'canceled routed capture must settle its owned journal before start completes');
	await setImmediate();
	const settledBeforeRemoval = stopSettled;
	assert.ok(await fixture.journal(), 'the owned journal remains durable until its conditional deletion completes');
	removal.release();
	const [startResult, stopResult] = await Promise.all([started, stopped]);

	assert.equal(settledBeforeRemoval, false, 'Stop must remain pending through owned journal removal');
	assert.equal(stopResult.status, 'fulfilled');
	assertCanceledStart(startResult);
	assert.equal(fixture.created.length, 0);
	assert.equal(fixture.controller.getSnapshot().recording, false);
	assert.equal(await fixture.journal(), null);
	assert.equal((await fixture.store.listSources()).length, 0);
	assert.equal(capturingInput.getAudioTracks()[0]!.stopCount, 1, 'Stop retires the input acquired by this capture');
});

test('an opaque routed preparation failure preserves the failure and abandons its ordinary journal', { timeout: 10_000 }, async context => {
	const fixture = await createFixture(context, { freshInputs: true });
	const failure = Object.freeze({ captureFailure: 'device preparation failed' });
	await fixture.controller.actions.recording.setTrackInput(fixture.trackId, {
		kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 1,
	});
	fixture.engine.getAudioContext = () => Promise.reject(failure);
	await assert.rejects(
		Promise.resolve(fixture.controller.actions.recording.start({ trackId: fixture.trackId })),
		(error: unknown) => error === failure,
	);
	assert.equal(fixture.created.length, 0);
	assert.equal(fixture.controller.getSnapshot().recording, false);
	assert.equal(await fixture.journal(), null);
});

test('a failed ordinary begin preserves a different capture journal and its committed PCM checkpoint', { timeout: 10_000 }, async context => {
	const fixture = await createFixture(context);
	await fixture.controller.actions.project.save();
	const base = await fixture.store.loadProject(fixture.projectId);
	assert.ok(base);
	const sourceId = 'independent-recording-checkpoint';
	const channels = [Float32Array.of(0.25, -0.5, 0.75, 0)];
	const writer = await fixture.store.beginSourceWrite(sourceId, {
		name: 'Independent recording', mimeType: 'audio/wav', sampleRate: 48_000, channelCount: 1,
	});
	await writer.write(channels);
	const metadata = await writer.commit();
	const repository = new RecordingRecoveryJournalRepository(fixture.store.analysisRepository);
	const created = await repository.create(fixture.projectId, 'independent-capture', base);
	const lane = await repository.addLane(created, 'independent-lane', {
		trackId: fixture.trackId, startFrame: 0, sourceOffsetFrames: 0, sampleRate: 48_000, selection: null,
	});
	const journal = await repository.append(lane, 'independent-lane', {
		sourceId, frameStart: 0, frameCount: 4, metadata,
	});

	await assert.rejects(
		Promise.resolve(fixture.controller.actions.recording.start({ trackId: fixture.trackId })),
		/already has an interrupted recording/u,
	);
	assert.equal(fixture.created.length, 0);
	assert.deepEqual(await fixture.journal(), journal, 'a failed begin has no authority over the existing capture');
	const stored = await fixture.store.readSourceChunk(sourceId, 0);
	assert.deepEqual(stored.channels, channels, 'the other capture keeps its committed recovery audio');
});

test('public Stop publishes a completed ordinary checkpoint before removing its recovery journal', { timeout: 10_000 }, async context => {
	const fixture = await createFixture(context);
	await fixture.controller.actions.recording.start({ trackId: fixture.trackId });
	const recorder = fixture.created[0];
	assert.ok(recorder);
	const channels = [new Float32Array(480_000).fill(0.25)];
	await recorder.onChunk({ frameStart: 0, frames: channels[0]!.length, channels });
	const journal = await fixture.journal();
	const checkpoint = journal?.lanes[0]?.segments[0];
	assert.ok(checkpoint, 'the normal capture has a durable ten-second checkpoint before Stop');
	assert.equal(checkpoint.frameCount, 480_000);

	await fixture.controller.actions.transport.stop();
	assert.equal(await fixture.journal(), null);
	assert.equal(fixture.controller.getSnapshot().recording, false);
	const saved = await fixture.store.loadProject(fixture.projectId);
	assert.ok(validateSoundscaperProject(saved));
	assert.equal(saved.sources.some(source => source.id === checkpoint.sourceId), true);
	assert.equal(saved.clips.length, 1, 'Stop retains captured audio as a durable project clip');
	const stored = await fixture.store.readSourceChunk(checkpoint.sourceId, 0);
	assert.equal(stored.channels[0]![0], 0.25);
});

test('Stop preserves handed-off start and finalization failures with their positive recovery checkpoint', { timeout: 10_000 }, async context => {
	let releasePlayback = () => {};
	const fixture = await createFixture(context, {
		freshInputs: true, acknowledgeStart: true, onRecorderStop: () => { releasePlayback(); },
	});
	const playback = fixture.gate();
	releasePlayback = playback.release;
	const startFailure = Object.freeze({ playbackFailure: 'clocked playback failed after recorder handoff' });
	const saveFailure = new Error('The recorded project could not be saved.');
	await fixture.controller.actions.recording.setTrackInput(fixture.trackId, {
		kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 1,
	});
	fixture.engine.playAt = async (contextTime: number, _frame: number, onBeforeStart?: ClockedPlaybackStartHook) => {
		assert.ok(onBeforeStart, 'the real routed capture supplies its recorder confirmation hook');
		await onBeforeStart(contextTime);
		playback.enter();
		await playback.wait;
		throw startFailure;
	};
	const started = fixture.track(fixture.controller.actions.recording.start({ trackId: fixture.trackId }));
	await assertEntered(playback.entered, started, 'routed capture confirms the recorder before waiting for playback');
	const recorder = fixture.created[0];
	const startFrame = recorder?.startOptions?.startFrame;
	assert.ok(recorder && startFrame !== undefined);
	assert.ok(startFrame > 0, 'the recorder accepted its scheduled AudioContext frame');
	assert.equal(fixture.controller.getSnapshot().recordingStarting, true, 'playback preparation still owns the public start phase');
	const channels = [new Float32Array(480_000).fill(0.25)];
	await recorder.onChunk({ frameStart: startFrame, frames: channels[0]!.length, channels });
	const positiveJournal = await fixture.journal();
	const checkpoint = positiveJournal?.lanes[0]?.segments[0];
	assert.ok(checkpoint, 'the pending playback owns a real committed recording checkpoint');
	assert.equal(checkpoint.frameCount, 480_000);
	const saveProject = fixture.store.saveProjectIfCurrentWithWriteFence;
	let saveAttempts = 0;
	fixture.store.saveProjectIfCurrentWithWriteFence = () => {
		saveAttempts += 1;
		return Promise.reject(saveFailure);
	};
	const restoreSave = () => { fixture.store.saveProjectIfCurrentWithWriteFence = saveProject; };
	context.signal.addEventListener('abort', restoreSave, { once: true });
	try {
		const stopped = fixture.track(fixture.controller.actions.transport.stop());
		const [startResult, stopResult] = await Promise.all([started, stopped]);
		assert.ok(startResult.status === 'rejected');
		assert.equal(startResult.reason, startFailure, 'handoff preserves the exact opaque start failure');
		assert.ok(stopResult.status === 'rejected' && stopResult.reason instanceof AggregateError);
		assert.equal(stopResult.reason.errors.includes(startFailure), true);
		assert.equal(stopResult.reason.errors.includes(saveFailure), true);
		assert.ok(saveAttempts > 0, 'actual recording finalization attempted a fenced project save');
		assert.deepEqual(await fixture.journal(), positiveJournal, 'failed finalization keeps positive recovery custody');
		const stored = await fixture.store.readSourceChunk(checkpoint.sourceId, 0);
		assert.equal(stored.channels[0]![0], 0.25);
		const saved = await fixture.store.loadProject(fixture.projectId);
		assert.ok(validateSoundscaperProject(saved));
		assert.equal(saved.clips.length, 0, 'the failed save has not durably attached the recovery audio');
	} finally {
		restoreSave();
		context.signal.removeEventListener('abort', restoreSave);
	}
});

interface FixtureOptions {
	readonly freshInputs?: boolean;
	readonly acknowledgeStart?: boolean;
	readonly onRecorderStop?: () => void;
}

type CreatedRecorderOptions = RecordingControllerFactoryOptions & {
	startOptions?: Readonly<{ startFrame?: number; stopFrame?: number }>;
};

async function createFixture(context: TestContext, { freshInputs = false, acknowledgeStart = false, onRecorderStop }: FixtureOptions = {}) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	// The authentic product profile fixes the memory-backend namespace, so each
	// sequential test clears it before the controller can reopen another take.
	await store.ready();
	await store.clear();
	const runtime = createSoundscaperProjectRuntimeSelection();
	const inputs: ReturnType<typeof createMockStream>[] = [];
	const makeInput = () => {
		const stream = createMockStream([createMockTrack('audio', { channelCount: 1 })]);
		inputs.push(stream);
		return stream;
	};
	const pool = createCapturePool({ hardware: { default: freshInputs ? makeInput : makeInput() } });
	const created: CreatedRecorderOptions[] = [];
	const defaultRecorderFactory = createRecordingControllerFactory(created);
	const recorderFactory: RecordingControllerFactory = async options => {
		const recorder: RecordingCaptureControllerLike = await defaultRecorderFactory(options);
		if (acknowledgeStart) recorder.startConfirmed = async schedule => {
			recorder.start(schedule);
			return { startFrame: schedule.startFrame };
		};
		if (onRecorderStop) {
			const stop = recorder.stop.bind(recorder);
			recorder.stop = async () => { onRecorderStop(); await stop(); };
		}
		return recorder;
	};
	const engine = createRecordingEngine();
	const releases: (() => void)[] = [];
	const pending: Promise<Settled>[] = [];
	const controller = createAudioEditorController(null, {
		headless: true, productId: 'soundscaper', locale: 'en',
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: engine as unknown as Options['engine'],
		ffmpeg: createFfmpegStub() as unknown as Options['ffmpeg'],
		recordingCapturePool: pool as unknown as Options['recordingCapturePool'],
		recordingControllerFactory: recorderFactory,
	});
	context.after(async () => {
		for (const release of releases) release();
		await Promise.all(pending);
		// Stop while publication still has a live controller lifetime, including
		// the late capture that the first RED regression intentionally exposes.
		try { await controller.actions.transport.stop(); }
		finally { await controller.dispose(); }
	});
	await controller.ready;
	await controller.actions.recording.setRetainInputs(false);
	const project = controller.getSnapshot().project;
	assert.ok(validateSoundscaperProject(project));
	assert.equal(project.schemaFamily, 'soundscaper', 'the fixture uses the product that owns ordinary recording recovery');
	const trackId = project.tracks[0]?.id;
	assert.ok(typeof trackId === 'string');
	const journals = new RecordingRecoveryJournalRepository(store.analysisRepository);
	return { controller, store, engine, inputs, created, trackId, projectId: project.id,
		journal: () => journals.load(project.id),
		track(operation: unknown) {
			const result = settled(operation);
			pending.push(result);
			return result;
		},
		gate() {
			const entered = deferred();
			const release = deferred();
			releases.push(release.resolve);
			return { entered: entered.promise, enter: entered.resolve, wait: release.promise, release: release.resolve };
		},
	};
}

type Settled = Readonly<{ status: 'fulfilled' }> | Readonly<{ status: 'rejected'; reason: unknown }>;

function settled(operation: unknown): Promise<Settled> {
	return Promise.resolve(operation).then(
		() => ({ status: 'fulfilled' as const }),
		(reason: unknown) => ({ status: 'rejected' as const, reason }),
	);
}

async function assertEntered(entered: Promise<void>, started: Promise<Settled>, message: string, unexpected?: Promise<void>): Promise<void> {
	const candidates: Promise<string | Settled>[] = [entered.then(() => 'entered'), started];
	if (unexpected) candidates.push(unexpected.then(() => 'cleanup entered before preparation'));
	const reached = await Promise.race(candidates);
	assert.equal(reached, 'entered', message);
}

function assertCanceledStart(result: Settled): void {
	if (result.status === 'fulfilled') return;
	assert.ok(result.reason && typeof result.reason === 'object' && 'name' in result.reason);
	assert.equal(result.reason.name, 'AbortError', 'cancellation must not hide an unrelated start failure');
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(complete => { resolve = complete; });
	return { promise, resolve };
}
