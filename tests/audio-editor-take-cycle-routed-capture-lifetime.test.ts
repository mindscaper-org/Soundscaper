/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createTakeCycleRoutedCaptureService,
	type TakeCycleRoutedCaptureRuntime,
} from '../src/common/editor/controller/recording/internal/take-cycle/take-cycle-routed-capture-service.ts';
import type { TakeCycleLiveCaptureSession } from '../src/common/editor/controller/recording/internal/take-cycle/take-cycle-live-capture-session.ts';
import type { RecordingControllerFactoryOptions } from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import { waitFor } from './helpers/async-test-control.ts';
import { RecordingInputLossError } from '../src/common/editor/recording-input-events.ts';

test('take-cycle physical input loss preserves valid captured PCM while recorder failure rejects it', async (context) => {
	const scenarios = [
		{ name: 'media track ended', preservesPrefix: true, interrupt: (fixture: ReturnType<typeof captureFixture>) => fixture.endInput() },
		{ name: 'audio context closed', preservesPrefix: true, interrupt: (fixture: ReturnType<typeof captureFixture>) => fixture.closeContext() },
		{ name: 'native recorder began stopping after device loss', preservesPrefix: true, interrupt: (fixture: ReturnType<typeof captureFixture>) => {
			fixture.recorderOptions()[0]!.onState('stopping');
		} },
		{ name: 'worklet input channels stopped arriving', preservesPrefix: true, interrupt: (fixture: ReturnType<typeof captureFixture>) => {
			fixture.recorderOptions()[0]!.onError(new RecordingInputLossError());
		} },
		{ name: 'recorder processor failed', preservesPrefix: false, interrupt: (fixture: ReturnType<typeof captureFixture>) => {
			fixture.recorderOptions()[0]!.onState('failed');
		} },
	] as const;
	for (const scenario of scenarios) await context.test(scenario.name, async () => {
		const fixture = captureFixture();
		const service = createTakeCycleRoutedCaptureService(fixture.runtime);
		await service.start({ kind: 'take-cycle-routed-capture' }, fixture.scope);
		await fixture.recorderOptions()[0]!.onChunk({
			frameStart: 0, frames: 4, channels: [Float32Array.of(0.25, 0.5, 0.75, 1)],
		});
		assert.deepEqual(fixture.listenerCounts(), { input: 1, context: 1 });

		try {
			scenario.interrupt(fixture);
			await waitFor(() => fixture.releaseCalls() === 1, 'the interrupted capture to release its route');
			await waitFor(() => fixture.sessionStopCalls() === 1, 'the owning recording session to settle');
			assert.equal(service.active, false);
			const result = await service.stop();

			assert.equal(Boolean(result.finalization), scenario.preservesPrefix);
			assert.deepEqual(result.lanes.map(({ status }) => status), [scenario.preservesPrefix ? 'committed' : 'failed']);
			assert.equal(fixture.discardCalls(), scenario.preservesPrefix ? 0 : 1);
			assert.equal(fixture.sealCalls(), scenario.preservesPrefix ? 1 : 0);
			assert.equal(fixture.finalizeCalls(), scenario.preservesPrefix ? 1 : 0);
			assert.deepEqual(fixture.listenerCounts(), { input: 0, context: 0 });
			assert.equal(fixture.stopCalls(), 1);
			assert.equal(fixture.disposeCalls(), 1);
			assert.equal(fixture.errors().length, 1);
		} finally {
			if (service.active) await service.stop();
		}
	});
});

test('take-cycle recording recovers a suspended context and continues the same durable lane', async () => {
	const fixture = captureFixture();
	const service = createTakeCycleRoutedCaptureService(fixture.runtime);
	await service.start({ kind: 'take-cycle-routed-capture' }, fixture.scope);
	fixture.suspendContext();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(service.active, true);
	assert.equal(fixture.stopCalls(), 0);
	assert.equal(fixture.discardCalls(), 0);
	await fixture.recorderOptions()[0]!.onChunk({ frameStart: 0, frames: 2, channels: [Float32Array.of(0.25, 0.5)] });
	const result = await service.stop();
	assert.equal(result.lanes[0]?.status, 'committed');
	assert.deepEqual(fixture.errors(), []);
});

test('take-cycle input loss while recorder construction is pending rolls back without starting stale capture', async () => {
	const fixture = captureFixture();
	const createRecorder = fixture.runtime.createRecorder;
	let constructed!: () => void, finishConstruction!: () => void;
	const ready = new Promise<void>(resolve => { constructed = resolve; });
	const gate = new Promise<void>(resolve => { finishConstruction = resolve; });
	fixture.runtime.createRecorder = async options => {
		const recorder = await createRecorder(options);
		constructed(); await gate; return recorder;
	};
	const service = createTakeCycleRoutedCaptureService(fixture.runtime);
	const starting = service.start({ kind: 'take-cycle-routed-capture' }, fixture.scope);
	await ready; fixture.endInput(); finishConstruction();
	await assert.rejects(starting, { name: 'MediaInputLostError' });
	assert.equal(service.active, false);
	assert.equal(fixture.discardCalls(), 1);
	assert.equal(fixture.finalizeCalls(), 0);
	assert.deepEqual(fixture.listenerCounts(), { input: 0, context: 0 });
});

function captureFixture() {
	const inputListeners = new Set<() => void>();
	const contextListeners = new Set<() => void>();
	const recorderOptions: RecordingControllerFactoryOptions[] = [];
	const errors: unknown[] = [];
	let inputState = 'live';
	let contextState = 'running';
	let releases = 0;
	let discards = 0;
	let seals = 0;
	let finalizations = 0;
	let recorderStops = 0;
	let recorderDisposals = 0;
	let sessionStops = 0;
	let capturedFrames = 0;
	const project = {
		id: 'project-cycle', sampleRate: 48_000,
		tracks: [{ id: 'track-a', type: 'audio', armed: true }],
		sequences: [{ id: 'main-sequence', trackIds: ['track-a'] }],
		primarySequenceId: 'main-sequence',
		loop: { enabled: true, startFrame: 100, endFrame: 500 },
		takeGroups: [],
	};
	const inputTrack = {
		get readyState() { return inputState; },
		getSettings: () => ({ channelCount: 1 }),
		addEventListener(type: 'ended', listener: () => void) {
			if (type === 'ended') inputListeners.add(listener);
		},
		removeEventListener(type: 'ended', listener: () => void) {
			if (type === 'ended') inputListeners.delete(listener);
		},
	};
	const stream = {
		getAudioTracks: () => [inputTrack],
		getTracks: () => [inputTrack],
	};
	const audioContext = {
		sampleRate: 48_000,
		currentTime: 3,
		get state() { return contextState; },
		async resume() { contextState = 'running'; },
		addEventListener(type: 'statechange', listener: () => void) {
			if (type === 'statechange') contextListeners.add(listener);
		},
		removeEventListener(type: 'statechange', listener: () => void) {
			if (type === 'statechange') contextListeners.delete(listener);
		},
	};
	const session: TakeCycleLiveCaptureSession = {
		projectId: project.id,
		publicationGeneration: 17,
		get pendingLaneCount() { return discards || seals ? 0 : 1; },
		async beginLane() {
			return {
				draftId: 'draft-a', spoolToken: 'spool-a', envelopeId: 'envelope-a', laneId: 'lane-a',
				get frameCount() { return capturedFrames; },
				async append(span) { capturedFrames += span.endSample - span.startSample; },
				async seal() { seals += 1; return { lane: { laneId: 'lane-a' } } as never; },
				async discard() { discards += 1; },
			};
		},
		async finalize() {
			finalizations += 1;
			return {
				kind: 'take-cycle-finalization', generation: 17,
				lanes: [{
					groupId: 'group-a', laneId: 'lane-a', status: 'committed', committedPasses: [], error: null,
				}],
			} as never;
		},
	};
	const runtime: TakeCycleRoutedCaptureRuntime = {
		orchestrator: { async beginLiveSession() { return session; } },
		capturePool: {
			async acquireHardware() { return stream; },
			async acquireDisplay() { return stream; },
		},
		engine: {
			async getAudioContext() { return audioContext; },
			setLoop() {}, seek() {}, async playAt(time) { return time; }, pause() {},
		},
		getProject: () => project,
		getRoutes: () => ({
			'track-a': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
		}),
		activeSelection: () => null,
		soundActivationEnabled: () => false,
		recordingRouteSourceKey: (route) => route.kind === 'display' ? 'display' : `device:${route.deviceId}`,
		streamAudioChannelCount: () => 1,
		recordingStreamIsLive: () => inputState === 'live',
		async createRecorder(options) {
			recorderOptions.push(options);
			return {
				start() {}, pause: () => false, resume: () => false,
				async stop() { recorderStops += 1; },
				async dispose() { recorderDisposals += 1; },
				setMonitoring() {}, setInputGain() {},
			};
		},
		createGroupId: () => 'group-a',
		createRecordingName: () => 'Cycle A',
		sourceChunkFrames: 1_024,
		async preflightStorage() {},
		async beginPlaybackCachePreparation() {},
		handleError(error) { errors.push(error); },
		stopRecording() { sessionStops += 1; },
		createResampler: () => ({ push: (channels) => channels, finish: () => [new Float32Array()] }),
		releaseInputs() { releases += 1; },
	};
	const scope = Object.freeze({
		generation: 1,
		projectId: project.id,
		assertCurrent() {},
	});
	return {
		runtime, scope,
		recorderOptions: () => recorderOptions,
		errors: () => errors,
		releaseCalls: () => releases,
		discardCalls: () => discards,
		sealCalls: () => seals,
		finalizeCalls: () => finalizations,
		stopCalls: () => recorderStops,
		disposeCalls: () => recorderDisposals,
		sessionStopCalls: () => sessionStops,
		listenerCounts: () => ({ input: inputListeners.size, context: contextListeners.size }),
		endInput() {
			inputState = 'ended';
			for (const listener of [...inputListeners]) listener();
		},
		suspendContext() {
			contextState = 'suspended';
			for (const listener of [...contextListeners]) listener();
		},
		closeContext() {
			contextState = 'closed';
			for (const listener of [...contextListeners]) listener();
		},
	};
}
