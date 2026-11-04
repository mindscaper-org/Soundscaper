/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeRecordingSoundActivationPreferences, type SoundActivationPreferences } from './sound-activation-preferences.ts';

export interface RecordingPreferences {
	readonly retainInputs: boolean;
	readonly alwaysRecordToNewTrack: boolean;
	readonly soundActivation: SoundActivationPreferences;
}

export function validateRecordingPreferences(value: unknown): void {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('preferences.recording must be an object.');
	}
	const recording = value as Record<string, unknown>;
	if (typeof recording.retainInputs !== 'boolean') throw new TypeError('recording.retainInputs must be boolean.');
	if (recording.alwaysRecordToNewTrack !== undefined && typeof recording.alwaysRecordToNewTrack !== 'boolean') {
		throw new TypeError('recording.alwaysRecordToNewTrack must be boolean.');
	}
}

export function normalizeRecordingPreferences(value?: unknown): RecordingPreferences {
	const recording = value as Partial<RecordingPreferences> | undefined;
	const normalized = {
		retainInputs: recording?.retainInputs !== false,
		alwaysRecordToNewTrack: recording?.alwaysRecordToNewTrack ?? false,
		soundActivation: normalizeRecordingSoundActivationPreferences(value),
	};
	validateRecordingPreferences(normalized);
	return normalized;
}
