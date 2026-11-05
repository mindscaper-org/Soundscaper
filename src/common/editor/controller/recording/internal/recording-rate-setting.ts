/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeRecordingSampleRate } from '../recording-model.ts';
import type { RecordingRoutingServiceRuntime } from './recording-routing-service-types.d.ts';

type RecordingRatePorts = Pick<RecordingRoutingServiceRuntime, 'state' | 'engine' | 'lifetime'> & Readonly<{
	persist(): Promise<unknown>;
	publish(): void;
}>;

/** Only the current rate choice owns preference publication or a context-preparation error. */
export function createRecordingRateSetting({ state, engine, lifetime, persist, publish }: RecordingRatePorts) {
	let generation = 0;
	return async function setRecordingSampleRate(sampleRate: number): Promise<number> {
		if (state.recorder || state.recordingStarting || state.recordingAdmissionPending || state.timedRecordingPreparing || state.timedRecording) {
			throw new Error('The recording sample rate cannot be changed while recording is active.');
		}
		const normalized = normalizeRecordingSampleRate(sampleRate);
		if (normalized !== sampleRate) throw new RangeError('Recording sample rate must be an integer between 8000 and 768000 Hz.');
		const request = ++generation;
		const assertCurrent = (): void => {
			if (request !== generation) throw superseded();
			lifetime.signal.throwIfAborted();
		};
		try {
			assertCurrent();
			if (state.audioHost !== 'browser' && state.audioHost !== 'electron') {
				await engine.getAudioContext?.({ resume: false, sampleRate: normalized });
			}
			assertCurrent();
			state.preferredRecordingSampleRate = normalized;
			await persist();
			assertCurrent();
			publish();
			return normalized;
		} catch (error) {
			// The engine may reject the old requested rate after a newer context
			// has already replaced it. That is supersession, not a device fault.
			assertCurrent();
			throw error;
		}
	};
}

function superseded(): DOMException {
	return new DOMException('The recording sample rate change was superseded.', 'AbortError');
}
