/* SPDX-License-Identifier: AGPL-3.0-only */

import { reviewMusicTranscriptionV1, MUSIC_TRANSCRIPTION_MAXIMUM_SAMPLES,
	MUSIC_TRANSCRIPTION_MAXIMUM_NOTES, type MusicTranscriptionV1, type TranscribedMusicNoteV1 } from './music-transcription-v1.ts';

export const BASIC_PITCH_INPUT_SAMPLES = 43_844;
export const BASIC_PITCH_OUTPUT_FRAMES = 172;
export const BASIC_PITCH_BORDER_FRAMES = 15;
export const BASIC_PITCH_RETAINED_FRAMES = BASIC_PITCH_OUTPUT_FRAMES - 2 * BASIC_PITCH_BORDER_FRAMES;
export const BASIC_PITCH_WINDOW_STEP = BASIC_PITCH_INPUT_SAMPLES - 30 * 256;

/** Use the actual input-window clock rather than accumulating rounded output-frame durations. */
export function basicPitchFrameSample(frame: number): number {
	return Math.floor(frame / BASIC_PITCH_RETAINED_FRAMES) * BASIC_PITCH_WINDOW_STEP
		+ frame % BASIC_PITCH_RETAINED_FRAMES * 256;
}

interface Activations {
	readonly frames: Float32Array;
	readonly onsets: Float32Array;
	readonly frameCount: number;
	readonly sampleCount: number;
}

/**
 * Bounded note-event decoding for Basic Pitch's note/onset probabilities. Keep
 * polyphony, split repeated attacks, bridge brief activation gaps and remove
 * short transients. Thresholds follow upstream's 0.5/0.3/127.7ms defaults.
 * This owned decoder produces plain MIDI notes; it does not decode pitch bends.
 */
export function decodeBasicPitchNotes(input: Activations, signal?: AbortSignal): MusicTranscriptionV1 {
	signal?.throwIfAborted();
	const { frames, onsets, frameCount, sampleCount } = input;
	if (!Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > 160_000
		|| !Number.isSafeInteger(sampleCount) || sampleCount < 1 || sampleCount > MUSIC_TRANSCRIPTION_MAXIMUM_SAMPLES
		|| !(frames instanceof Float32Array) || !(onsets instanceof Float32Array)
		|| frames.length !== frameCount * 88 || onsets.length !== frames.length) throw new RangeError('Invalid Basic Pitch tensor geometry.');
	for (let i = 0; i < frames.length; i++) {
		if ((i & 16_383) === 0) signal?.throwIfAborted();
		for (const value of [frames[i]!, onsets[i]!]) if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Basic Pitch tensors must contain finite probabilities.');
	}
	const notes: TranscribedMusicNoteV1[] = [];
	for (let pitch = 0; pitch < 88; pitch++) {
		signal?.throwIfAborted();
		let start = -1, lastAbove = -1, sum = 0, lastSum = 0;
		const finish = (): void => {
			const end = lastAbove + 1;
			if (start >= 0 && end - start > 11) {
				const startSample = basicPitchFrameSample(start);
				const endSample = Math.min(sampleCount, basicPitchFrameSample(end));
				if (endSample > startSample) notes.push({ pitch: pitch + 21, startSample,
					durationSamples: endSample - startSample,
					velocity: Math.max(1, Math.min(127, Math.round(lastSum / (end - start) * 127))) });
				if (notes.length > MUSIC_TRANSCRIPTION_MAXIMUM_NOTES) throw new RangeError('Basic Pitch exceeds its note capacity.');
			}
			start = -1; lastAbove = -1; sum = 0; lastSum = 0;
		};
		for (let t = 0; t < frameCount && basicPitchFrameSample(t) < sampleCount; t++) {
			if ((t & 16_383) === 0) signal?.throwIfAborted();
			const value = frames[t * 88 + pitch]!;
			const onset = onsets[t * 88 + pitch]!;
			const attack = onset >= 0.5 && (t === 0 || onset > onsets[(t - 1) * 88 + pitch]!)
				&& (t + 1 === frameCount || onset > onsets[(t + 1) * 88 + pitch]!);
			if (start >= 0 && attack && t - start > 11) { lastAbove = t - 1; lastSum = sum; finish(); }
			if (start < 0 && value >= 0.3 && (attack || value >= 0.5)) start = t;
			if (start < 0) continue;
			sum += value;
			if (value >= 0.3) { lastAbove = t; lastSum = sum; }
			else if (t - lastAbove >= 11) finish();
		}
		finish();
	}
	notes.sort((a, b) => a.startSample - b.startSample || a.pitch - b.pitch);
	return reviewMusicTranscriptionV1({ schemaVersion: 1, sampleRate: 22_050, sampleCount, notes });
}
