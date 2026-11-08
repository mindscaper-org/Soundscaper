/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createAudioEditorController, createProjectStore, createMockStream, createMockTrack,
	createRecordingCapturePool } from './audio-editor-recording-controller-harness.js';
import { createAudioEditorEngine } from '../../src/common/editor/engine/runtime-class.ts';
import type { EngineAudioContext } from '../../src/common/editor/engine/public-api.ts';
import type { RecordingControllerFactory, RecordingControllerFactoryOptions } from '../../src/common/editor/controller/recording/recording-transaction-types.ts';
import { createSoundscaperProjectRuntimeSelection } from '../../src/soundscaper/editor-project-runtime-selection.ts';
import { MockAudioContext } from './mock-audio-context.js';
import { deferred } from './async-test-control.ts';

interface RecorderEntry extends RecordingControllerFactoryOptions {
	startOptions?: Readonly<{ startFrame: number; stopFrame?: number }>;
}

export async function soundActivationStartFixture(t: TestContext, routed = false) {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: t.name });
	const entered = deferred<void>(), release = deferred<void>();
	let hold = false, failure: Error | null = null, inputRequests = 0, resumes = 0;
	const saveSetting = store.saveSetting.bind(store);
	store.saveSetting = async (key: string, value: unknown) => {
		if (hold && key === 'soundscaper:audio-editor-preferences-v1') {
			entered.resolve(); await release.promise;
			if (failure) throw failure;
		}
		return saveSetting(key, value);
	};
	const context = Object.assign(new MockAudioContext({ sampleRate: 48_000 }), {
		currentTime: 4, baseLatency: 0, outputLatency: 0,
		addEventListener() {}, removeEventListener() {},
		createMediaStreamSource() { return { connect() {}, disconnect() {} }; },
		createChannelSplitter() { return { connect() {}, disconnect() {} }; },
	});
	const resume = context.resume.bind(context);
	context.resume = async () => { resumes += 1; await resume(); };
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context as unknown as EngineAudioContext,
		offlineAudioContextFactory: null,
	});
	const pool = createRecordingCapturePool({ requestHardwareInput: async () => {
		inputRequests += 1;
		return createMockStream([createMockTrack('audio', { channelCount: 1 })]);
	} });
	const created: RecorderEntry[] = [];
	const createRecorder: RecordingControllerFactory = async options => {
		const entry: RecorderEntry = { ...options }; created.push(entry); let state = 'ready';
		const start = (value: Readonly<{ startFrame: number; stopFrame?: number }>) => {
			entry.startOptions = value; state = 'recording';
		};
		return {
			get state() { return state; },
			start(value = {}) { start({ ...value, startFrame: value.startFrame ?? 0 }); },
			async startConfirmed(value) { start(value); return { startFrame: value.startFrame }; },
			async rescheduleConfirmed(value) { start(value); return { startFrame: value.startFrame }; },
			pause() { state = 'paused'; return true; }, resume() { state = 'recording'; return true; },
			async stop() { state = 'stopped'; }, async dispose() { state = 'disposed'; },
			setMonitoring() {}, setInputGain() {},
		};
	};
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, {
		headless: true, locale: 'en', engine, store, projectRuntime: runtime,
		sessionController: runtime.createSessionController(), recordingCapturePool: pool,
		recordingControllerFactory: createRecorder,
	});
	t.after(async () => { release.resolve(); await controller.actions.recording.stop(); await controller.dispose(); });
	await controller.ready;
	const trackId = controller.getSnapshot().project?.tracks?.[0]?.id; assert.equal(typeof trackId, 'string');
	assert.ok(typeof trackId === 'string');
	if (routed) await controller.actions.recording.setTrackInput(trackId, { kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 1 });
	const actions = controller.actions.recording.soundActivation;
	await actions.setThresholdDb(-10); await actions.setHoldMilliseconds(0);
	return {
		controller, trackId, actions, created, entered, release,
		get inputRequests() { return inputRequests; }, get resumes() { return resumes; },
		holdPreferences(error: Error | null = null) { hold = true; failure = error; },
		allowPreferences() { hold = false; failure = null; release.resolve(); },
		async capture() {
			const recorder = created.at(-1); assert.ok(recorder?.startOptions);
			await recorder.onChunk({ frameStart: recorder.startOptions.startFrame, frames: 4_800,
				channels: [new Float32Array(4_800).fill(.02)] });
			await controller.actions.recording.stop();
			return controller.getSnapshot().project?.clips?.length;
		},
	};
}
