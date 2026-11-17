/* SPDX-License-Identifier: AGPL-3.0-only */

import { reviewMusicTranscriptionV1, MUSIC_TRANSCRIPTION_MAXIMUM_SAMPLES,
	MUSIC_TRANSCRIPTION_MAXIMUM_NOTES, type MusicTranscriptionV1, type TranscribedMusicNoteV1 } from './music-transcription-v1.ts';

export const BASIC_PITCH_INPUT_SAMPLES = 43_844;
export const BASIC_PITCH_OUTPUT_FRAMES = 172;
export const BASIC_PITCH_BORDER_FRAMES = 15;
export const BASIC_PITCH_RETAINED_FRAMES = BASIC_PITCH_OUTPUT_FRAMES - 2 * BASIC_PITCH_BORDER_FRAMES;
export const BASIC_PITCH_WINDOW_STEP = BASIC_PITCH_INPUT_SAMPLES - 30 * 256;
const PITCHES = 88;

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
	const { frames, onsets, frameCount, sampleCount } = input;
	const decoder = createBasicPitchNoteDecoder(frameCount, sampleCount, signal);
	decoder.push(frames, onsets);
	return decoder.finish();
}

/** Keep note state and one row of lookahead across ordered inference packets. */
export function createBasicPitchNoteDecoder(frameCount: number, sampleCount: number, signal?: AbortSignal) {
	signal?.throwIfAborted();
	if (!Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > 160_000
		|| !Number.isSafeInteger(sampleCount) || sampleCount < 1 || sampleCount > MUSIC_TRANSCRIPTION_MAXIMUM_SAMPLES) {
		throw new RangeError('Invalid Basic Pitch tensor geometry.');
	}
	const starts = new Int32Array(PITCHES).fill(-1), lastAbove = new Int32Array(PITCHES).fill(-1);
	const sums = new Float64Array(PITCHES), lastSums = new Float64Array(PITCHES);
	const previousOnsets = new Float32Array(PITCHES), pendingFrames = new Float32Array(PITCHES), pendingOnsets = new Float32Array(PITCHES);
	const notes: TranscribedMusicNoteV1[] = [];
	let accepted = 0, processed = 0, finished = false;
	function finishPitch(pitch: number): void {
		const start = starts[pitch]!, end = lastAbove[pitch]! + 1;
		if (start >= 0 && end - start > 11) {
			const startSample = basicPitchFrameSample(start);
			const endSample = Math.min(sampleCount, basicPitchFrameSample(end));
			if (endSample > startSample) notes.push({ pitch: pitch + 21, startSample,
				durationSamples: endSample - startSample,
				velocity: Math.max(1, Math.min(127, Math.round(lastSums[pitch]! / (end - start) * 127))) });
			if (notes.length > MUSIC_TRANSCRIPTION_MAXIMUM_NOTES) throw new RangeError('Basic Pitch exceeds its note capacity.');
		}
		starts[pitch] = -1; lastAbove[pitch] = -1; sums[pitch] = 0; lastSums[pitch] = 0;
	}
	function process(frames: Float32Array, onsets: Float32Array, offset: number,
		prior: Float32Array, priorOffset: number, next?: Float32Array, nextOffset = 0): void {
		const frame = processed++;
		if ((frame & 255) === 0) signal?.throwIfAborted();
		if (basicPitchFrameSample(frame) >= sampleCount) return;
		for (let pitch = 0; pitch < PITCHES; pitch++) {
			const value = frames[offset + pitch]!;
			const onset = onsets[offset + pitch]!;
			const attack = onset >= 0.5 && (frame === 0 || onset > prior[priorOffset + pitch]!)
				&& (!next || onset > next[nextOffset + pitch]!);
			if (starts[pitch]! >= 0 && attack && frame - starts[pitch]! > 11) {
				lastAbove[pitch] = frame - 1; lastSums[pitch] = sums[pitch]!; finishPitch(pitch);
			}
			if (starts[pitch]! < 0 && value >= 0.3 && (attack || value >= 0.5)) starts[pitch] = frame;
			if (starts[pitch]! < 0) continue;
			sums[pitch] = sums[pitch]! + value;
			if (value >= 0.3) { lastAbove[pitch] = frame; lastSums[pitch] = sums[pitch]!; }
			else if (frame - lastAbove[pitch]! >= 11) finishPitch(pitch);
		}
	}
	return {
		push(frames: Float32Array, onsets: Float32Array): void {
			signal?.throwIfAborted();
			if (finished || !(frames instanceof Float32Array) || !(onsets instanceof Float32Array)
				|| frames.length < PITCHES || frames.length % PITCHES || onsets.length !== frames.length
				|| accepted + frames.length / PITCHES > frameCount) throw new RangeError('Invalid Basic Pitch tensor geometry.');
			for (let index = 0; index < frames.length; index++) {
				if ((index & 16_383) === 0) signal?.throwIfAborted();
				if (!validProbability(frames[index]!) || !validProbability(onsets[index]!)) {
					throw new RangeError('Basic Pitch tensors must contain finite probabilities.');
				}
			}
			if (accepted > 0) process(pendingFrames, pendingOnsets, 0, previousOnsets, 0, onsets);
			const tail = frames.length - PITCHES;
			for (let offset = 0; offset < tail; offset += PITCHES) {
				process(frames, onsets, offset, offset === 0 ? pendingOnsets : onsets,
					Math.max(0, offset - PITCHES), onsets, offset + PITCHES);
			}
			previousOnsets.set(tail === 0 ? pendingOnsets : onsets.subarray(tail - PITCHES, tail));
			pendingFrames.set(frames.subarray(tail)); pendingOnsets.set(onsets.subarray(tail));
			accepted += frames.length / PITCHES;
		},
		finish(): MusicTranscriptionV1 {
			signal?.throwIfAborted();
			if (finished || accepted !== frameCount) throw new RangeError('Invalid Basic Pitch tensor geometry.');
			finished = true;
			process(pendingFrames, pendingOnsets, 0, previousOnsets, 0);
			for (let pitch = 0; pitch < PITCHES; pitch++) finishPitch(pitch);
			notes.sort((a, b) => a.startSample - b.startSample || a.pitch - b.pitch);
			return reviewMusicTranscriptionV1({ schemaVersion: 1, sampleRate: 22_050, sampleCount, notes });
		},
	};
}

function validProbability(value: number): boolean {
	return Number.isFinite(value) && value >= 0 && value <= 1;
}
