/* SPDX-License-Identifier: AGPL-3.0-only */

import { createMicrophoneMeterService, type MeterMediaStream, type MicrophoneMeterState } from '../../src/common/editor/controller/recording/microphone-meter-service.ts';
import { createOwnedStateAccess } from '../../src/common/editor/controller/shared/owned-state.ts';
import { MockAudioContext } from './mock-audio-context.js';

export function activeMeterFixture() {
	type Mutable<Value> = { -readonly [Key in keyof Value]: Value[Key] };
	const state: Mutable<MicrophoneMeterState> = {
		disposed: false, microphoneMetering: false, recorder: null, recordingStarting: false,
		recordingAdmissionPending: false, timedRecordingPreparing: false, timedRecording: null,
		preferences: { recording: { retainInputs: false } }, recordingInputGain: 1, transportState: 'stopped',
		inputLoudnessMeasurementManuallyPaused: false, inputLoudnessMeasurementExplicitlyRunning: false,
		inputMeterDb: -60, inputMeter: null, selectedTrackId: null, recordingRouting: { routes: {} },
	};
	let input: Readonly<{ end(): void }> | null = null, held: MeterMediaStream | null = null, nextInterval = 0;
	const intervals = new Set<number>(), persisted: Array<readonly [string, unknown]> = [];
	const context = new class extends MockAudioContext {
		createMediaStreamSource() { return this.createGain(); }
		override createAnalyser() {
			return Object.assign(super.createAnalyser(), { fftSize: 256, smoothingTimeConstant: 0,
				getFloatTimeDomainData: (values: Float32Array) => { values.fill(.25); } });
		}
	}({ sampleRate: 96_000 });
	const service = createMicrophoneMeterService({
		state: createOwnedStateAccess(state, state), defaultDeviceId: 'default',
		getPreferredInput: () => ({ deviceId: 'default', channelCount: 1 }),
		recordingCapturePool: {
			getHardware: () => held,
			acquireHardware: async () => {
				const track = Object.assign(new EventTarget(), { getSettings: () => ({ channelCount: 1 }) });
				const stream = { getAudioTracks: () => [track], end: () => { track.dispatchEvent(new Event('ended')); } };
				input = stream; held = stream; return stream;
			},
			releaseHardware: () => { held = null; },
		},
		getAudioContext: async () => context,
		createLoudnessMeterNode: async () => ({ node: context.createGain(), setRunning() {}, setInputGain() {}, reset() {} }),
		streamAudioChannelCount: () => 1, projectSampleRate: () => 96_000,
		persistSetting: async (key, value) => { persisted.push([key, value]); },
		publishDocumentSnapshot() {}, publishTelemetrySnapshot() {}, syncRecordingPoolSnapshot() {},
		handleError: error => { throw error; },
		scheduleInterval: () => { const id = ++nextInterval; intervals.add(id); return id; },
		clearInterval: id => { if (typeof id === 'number') intervals.delete(id); },
	});
	return { service, persisted, intervals, endInput: () => { input?.end(); } };
}
