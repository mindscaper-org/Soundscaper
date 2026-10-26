/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMicrophoneMeterService, type MicrophoneMeterState } from '../src/common/editor/controller/recording/microphone-meter-service.ts';
import { createLegacyRecordingCaptureService } from '../src/common/editor/controller/recording/internal/legacy-recording-capture-service.ts';
import { createOwnedStateAccess } from '../src/common/editor/controller/shared/owned-state.ts';
import { createRecordingCaptureFixture, createScope, deferred } from './fixtures/recording-capture-fixture.ts';
import type { RecordingMediaStream } from '../src/common/editor/controller/recording/recording-transaction-types.ts';

function fixture(acquireHardware?: () => Promise<RecordingMediaStream>) {
	const capture = createRecordingCaptureFixture();
	const state = Object.assign(capture.state, {
		microphoneMetering: false, preferences: { recording: { retainInputs: false } },
		transportState: 'stopped', inputLoudnessMeasurementManuallyPaused: false,
		inputLoudnessMeasurementExplicitlyRunning: false,
	}) satisfies MicrophoneMeterState;
	let meterCount = 0;
	let onMeter: ((reading: unknown) => void) | null = null;
	const node = () => ({ connect() {}, disconnect() {} });
	const context = { destination: node(), createMediaStreamSource: node,
		createChannelSplitter: node, createChannelMerger: node,
		createAnalyser: () => ({ ...node(), fftSize: 256, smoothingTimeConstant: 0,
			getFloatTimeDomainData: (target: Float32Array) => { target.fill(.25); } }),
	};
	const service = createMicrophoneMeterService({
		state: createOwnedStateAccess(state, state), defaultDeviceId: 'default',
		recordingCapturePool: { ...capture.runtime.capturePool, releaseHardware() {},
			...(acquireHardware ? { acquireHardware } : {}) },
		getAudioContext: async () => context,
		createLoudnessMeterNode: async (_context, options) => {
			meterCount++;
			onMeter = options.onMeter;
			return { node: node(), setRunning() {}, setInputGain() {}, reset() {}, dispose() {} };
		},
		streamAudioChannelCount: () => 2, projectSampleRate: () => 48_000,
		persistSetting() {}, publishDocumentSnapshot() {}, publishTelemetrySnapshot() {},
		syncRecordingPoolSnapshot() {}, handleError: error => { throw error; },
		scheduleInterval: () => 1, clearInterval() {},
	});
	return { capture, state, service, meterCount: () => meterCount,
		publishMeter: (reading: unknown) => { onMeter?.(reading); } };
}

test('default stereo Record creates its input loudness meter while idle microphone metering stays disabled', async () => {
	const value = fixture();
	try {
		// Recording composition uses this forced port for the track's default stereo Record action.
		await createLegacyRecordingCaptureService({ ...value.capture.runtime,
			startMicrophoneMetering: () => value.service.startMicrophoneMetering({ force: true }),
		}).capture({ trackId: 'track-1' }, createScope(() => true));
		assert.ok(value.state.recorder);
		assert.equal(value.state.microphoneMetering, false, 'recording does not change the saved idle-meter preference');
		assert.equal(value.meterCount(), 1);
		assert.equal(value.service.getSession()?.analysers.length, 2);
		value.publishMeter({ dbfs: -12, integratedLufs: -23 });
		assert.equal((value.state.inputMeter as { integratedLufs: number }).integratedLufs, -23);
		value.state.recorder = null;
		value.service.handleTransportState('recording', 'stopped');
		assert.equal(value.service.getSession(), null);
	} finally { value.service.dispose(); }
});

test('canceling a recording start retires a pending forced meter', async () => {
	const acquired = deferred<RecordingMediaStream>();
	const value = fixture(() => acquired.promise);
	const acquire = value.capture.runtime.capturePool.acquireHardware;
	value.state.recordingStarting = true;
	const starting = value.service.startMicrophoneMetering({ force: true });
	value.state.recordingStarting = false;
	acquired.resolve(await acquire('default', { channelCount: 2, sampleRate: 48_000 }));
	assert.equal(await starting, false);
	assert.equal(value.service.getSession(), null);
	assert.equal(value.meterCount(), 0);
});
