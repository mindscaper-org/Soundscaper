/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMicrophoneMeterService, type MicrophoneMeterState } from '../src/common/editor/controller/recording/microphone-meter-service.ts';
import { createRoutedRecordingCaptureService } from '../src/common/editor/controller/recording/internal/routed-recording-capture-service.ts';
import { createOwnedStateAccess } from '../src/common/editor/controller/shared/owned-state.ts';
import { createEbuR128Meter } from '../src/common/editor/ebu-r128.js';
import { createRecordingCaptureFixture, createScope } from './fixtures/recording-capture-fixture.ts';

for (const callback of ['peak timer', 'loudness worklet'] as const) test(`idle ${callback} cannot overwrite a different track's current recording meter`, async () => {
	const capture = createRecordingCaptureFixture();
	const state = Object.assign(capture.state, { microphoneMetering: false,
		preferences: { recording: { retainInputs: false } }, transportState: 'stopped',
		inputLoudnessMeasurementManuallyPaused: false, inputLoudnessMeasurementExplicitlyRunning: false,
	}) satisfies MicrophoneMeterState;
	state.selectedTrackId = 'track-2';
	state.recordingRouting = { routes: {
		'track-1': { kind: 'device', deviceId: 'recorded', channelStart: 0, channelCount: 2 },
		'track-2': { kind: 'device', deviceId: 'idle', channelStart: 0, channelCount: 1 },
	}, offsets: {} };
	let tick: () => void = () => {};
	let onMeter: (reading: unknown) => void = () => {};
	const node = () => ({ connect() {}, disconnect() {} });
	const service = createMicrophoneMeterService({ state: createOwnedStateAccess(state, state), defaultDeviceId: 'default',
		recordingCapturePool: { ...capture.runtime.capturePool, releaseHardware() {} },
		getAudioContext: async () => ({ destination: node(), createMediaStreamSource: node,
			createChannelSplitter: node, createChannelMerger: node,
			createAnalyser: () => ({ ...node(), fftSize: 256, smoothingTimeConstant: 0,
				getFloatTimeDomainData: (target: Float32Array) => { target.fill(.25); } }),
		}),
		createLoudnessMeterNode: async (_context, options) => {
			onMeter = options.onMeter;
			return { node: node(), setRunning() {}, setInputGain() {}, reset() {}, dispose() {} };
		},
		streamAudioChannelCount: () => 2, projectSampleRate: () => 48_000,
		persistSetting() {}, publishDocumentSnapshot() {}, publishTelemetrySnapshot() {}, syncRecordingPoolSnapshot() {},
		handleError: error => { throw error; }, scheduleInterval: update => { tick = update; return 1; }, clearInterval() {},
	});
	try {
		await service.setMicrophoneMetering(true);
		assert.equal(service.getSession()?.deviceId, 'idle');
		// Multitrack Record captures the armed track while the selected unarmed track stays idle.
		await createRoutedRecordingCaptureService({ ...capture.runtime, createLoudnessMeter: createEbuR128Meter,
			getProject: () => ({ ...capture.project, tracks: capture.project.tracks.map(track => ({ ...track, armed: track.id === 'track-1' })) }),
			getLoudnessMeter: () => ({ meter: service.getRoutedLoudnessMeter(), key: service.getRoutedLoudnessMeterKey() }),
			setLoudnessMeter: service.setRoutedLoudnessMeter,
		}).capture({}, createScope(() => true));
		const options = capture.recorderOptions();
		assert.ok(options);
		await options.onChunk({ frameStart: capture.recorderStartOptions[0]!.startFrame!, frames: 4_800,
			channels: [new Float32Array(4_800).fill(.8), new Float32Array(4_800).fill(.4)] });
		const recorded = state.inputMeter;
		assert.ok(recorded && typeof recorded === 'object' && 'peak' in recorded);
		assert.ok(Math.abs(Number(recorded.peak) - .8) < 1e-6);
		assert.ok('channels' in recorded && Array.isArray(recorded.channels));
		assert.deepEqual(recorded.channels.map((channel: unknown) => {
			assert.ok(channel && typeof channel === 'object' && 'peak' in channel && 'rms' in channel);
			assert.ok(Math.abs(Number(channel.rms) - Number(channel.peak)) < 1e-10);
			return channel.peak;
		}), [.8, .4].map(Math.fround));
		if (callback === 'peak timer') tick();
		else onMeter({ peak: .1, dbfs: -20, integratedLufs: -40 });
		assert.deepEqual(state.inputMeter, recorded, 'the current recorded route must retain authority over its meter');
		assert.equal(capture.writerRecords[0]?.writes[0]?.[0]?.[0], Math.fround(.8), 'meter arbitration preserves captured PCM');
		state.recorder = null;
		state.recordingEntries = null;
		tick();
		assert.notDeepEqual(state.inputMeter, recorded, 'the retained idle meter resumes after capture ends');
	} finally { service.dispose(); }
});
