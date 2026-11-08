/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { RecordingCaptureControllerLike } from '../src/common/editor/controller/recording/internal/recording-session-service.ts';
import {
	createTakeCyclePendingInputBinding, createTakeCycleRoutedCaptureControls,
} from '../src/common/editor/controller/recording/internal/take-cycle/take-cycle-routed-capture-controls.ts';
import { deferred } from './helpers/async-test-control.ts';
import {
	createAudioEditorController, createCapturePool, createFfmpegStub, createMockStream,
	createMockTrack, createProjectStore, createRecordingEngine,
} from './helpers/audio-editor-recording-controller-harness.js';

type Window = 'factory' | 'backing' | 'confirmation';
for (const window of ['factory', 'backing', 'confirmation'] as const) {
	for (const when of ['before', 'during']) test(`take capture retains zero level ${when} ${window} readiness`, async context => {
		const fixture = await takeFixture(context, window);
		if (when === 'before') fixture.controller.actions.recording.setLevel(0);
		const starting = fixture.controller.actions.recording.cycle.start();
		await fixture.entered.promise;
		if (when === 'during') fixture.controller.actions.recording.setLevel(0);
		fixture.release.resolve();
		await starting;
		assert.deepEqual(fixture.startGains, [0]);
	});

	test(`display capture retains unity through ${window} microphone-level changes`, async context => {
		const fixture = await takeFixture(context, window, 'display');
		const starting = fixture.controller.actions.recording.cycle.start();
		await fixture.entered.promise;
		fixture.controller.actions.recording.setLevel(0);
		fixture.release.resolve();
		await starting;
		assert.deepEqual(fixture.startGains, [1]);
		assert.deepEqual(fixture.updates, [], 'microphone gain never scales display samples');
	});

	test(`Stop retires pending gain forwarding during ${window} readiness`, async context => {
		const fixture = await takeFixture(context, window);
		const starting = Promise.resolve(fixture.controller.actions.recording.cycle.start()).catch(error => {
			assert.equal(error?.name, 'AbortError');
		});
		await fixture.entered.promise;
		const stopping = fixture.controller.actions.transport.stop();
		const before = [...fixture.updates];
		fixture.controller.actions.recording.setLevel(0);
		fixture.release.resolve();
		await Promise.all([starting, stopping]);
		assert.deepEqual(fixture.updates, before, 'canceled controllers receive no later gain handoff');
		assert.equal(fixture.disposed(), true);
		assert.equal(fixture.controller.getSnapshot().recording, false);
	});
}

test('an older pending-input release cannot clear its successor and a canceled scope receives no controls', () => {
	const binding = createTakeCyclePendingInputBinding();
	const oldValues: number[] = [], nextValues: number[] = [];
	let valid = true;
	const old = binding.bind([{ kind: 'device', controller: gainController(oldValues) }], () => {});
	const next = binding.bind([{ kind: 'device', controller: gainController(nextValues) }], () => {
		if (!valid) throw new DOMException('Canceled', 'AbortError');
	});
	const controls = createTakeCycleRoutedCaptureControls(() => null,
		async () => { throw new Error('Unused start'); }, async () => { throw new Error('Unused stop'); }, binding.read);
	old();
	controls.setInputGain(.4);
	assert.deepEqual(oldValues, []);
	assert.deepEqual(nextValues, [.4]);
	assert.equal(controls.active, false, 'preparing controls do not publish active capture');
	valid = false;
	controls.setInputGain(0);
	assert.deepEqual(nextValues, [.4]);
	next();
	assert.equal(binding.read(), null);
});

function gainController(values: number[]): RecordingCaptureControllerLike {
	return { start() {}, stop() {}, pause: () => false, resume: () => false, setMonitoring() {},
		setInputGain(value) { values.push(value); } };
}

async function takeFixture(context: TestContext, window: Window, kind: 'device' | 'display' = 'device') {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const entered = deferred<void>(), release = deferred<void>();
	const base = createRecordingEngine();
	const engine = { ...base, async playAt(time: number, from: number, beforeStart?: (candidate: number) => Promise<number>) {
		if (window === 'backing') { entered.resolve(); await release.promise; }
		const at = beforeStart ? await beforeStart(time) : time;
		await base.playAt(at, from);
		this.state = base.state;
		return at;
	} };
	const stream = createMockStream([createMockTrack('audio', { channelCount: 1 }),
		...(kind === 'display' ? [createMockTrack('video')] : [])]);
	let gain = 1, state = 'ready';
	const startGains: number[] = [], updates: number[] = [];
	const startRecorder = () => {
		if (state === 'disposed') throw new DOMException('Canceled', 'AbortError');
		startGains.push(gain); state = 'recording';
	};
	const controller = createAudioEditorController(null, {
		headless: true, store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: engine as unknown as Options['engine'], ffmpeg: createFfmpegStub() as unknown as Options['ffmpeg'],
		recordingCapturePool: createCapturePool({ hardware: { default: stream }, display: stream }) as unknown as Options['recordingCapturePool'],
		async recordingControllerFactory(configuration) {
			gain = configuration.inputGain ?? 1;
			if (window === 'factory') { entered.resolve(); await release.promise; }
			return {
				get state() { return state; }, start: startRecorder,
				async startConfirmed(options) {
					if (window === 'confirmation') { entered.resolve(); await release.promise; }
					startRecorder(); return { startFrame: options.startFrame };
				},
				pause: () => false, resume: () => false, stop() { state = 'stopped'; },
				setMonitoring() {}, setInputGain(value) { gain = value; updates.push(value); },
				dispose() { state = 'disposed'; },
			};
		},
	});
	context.after(async () => {
		release.resolve();
		await controller.actions.recording.stop().catch(error => { if (error?.name !== 'AbortError') throw error; });
		await controller.dispose();
	});
	await controller.ready;
	const trackId = controller.getSnapshot().project?.tracks?.[0]?.id;
	assert.ok(typeof trackId === 'string');
	await controller.actions.recording.setTrackInput(trackId, kind === 'device'
		? { kind, deviceId: 'default', channelStart: 0, channelCount: 1 }
		: { kind, channelStart: 0, channelCount: 1 });
	controller.actions.transport.setLoopRegion(0, 48_000);
	controller.actions.track.update(trackId, { armed: true });
	return { controller, entered, release, startGains, updates, disposed: () => state === 'disposed' };
}
