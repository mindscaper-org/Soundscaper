/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createBasicPitchNoteDecoder, decodeBasicPitchNotes, basicPitchFrameSample } from '../src/common/editor/assistance/basic-pitch-notes.ts';
import { reviewMusicTranscriptionV1, musicTranscriptionMidiDocument } from '../src/common/editor/assistance/music-transcription-v1.ts';

function activations(count = 80) {
	const frames = new Float32Array(count * 88);
	const onsets = new Float32Array(count * 88);
	return { frames, onsets, frameCount: count, sampleCount: 22_050 };
}
function note(value: ReturnType<typeof activations>, pitch: number, start: number, end: number) {
	for (let frame = start; frame < end; frame++) value.frames[frame * 88 + pitch - 21] = 0.8;
	value.onsets[start * 88 + pitch - 21] = 0.9;
}

test('Basic Pitch decodes simultaneous notes with independent durations and velocity', () => {
	const input = activations();
	note(input, 60, 5, 35); note(input, 64, 5, 45); note(input, 67, 5, 55);
	const result = decodeBasicPitchNotes(input);
	assert.deepEqual(result.notes, [
		{ pitch: 60, startSample: 1280, durationSamples: 7680, velocity: 102 },
		{ pitch: 64, startSample: 1280, durationSamples: 10240, velocity: 102 },
		{ pitch: 67, startSample: 1280, durationSamples: 12800, velocity: 102 },
	]);
	const midi = musicTranscriptionMidiDocument(result, 48_000, 'Piano');
	assert.deepEqual(midi.tracks[0]!.notes.map(n => n.pitch), [60, 64, 67]);
	assert.equal(midi.tracks[0]!.durationFrames, 48_000);
	assert.equal(midi.tracks[0]!.notes[0]!.startFrame, 2786);
});

test('onsets split repeated pitches while brief activation gaps retain a sustained note', () => {
	const input = activations(); note(input, 69, 3, 70);
	input.onsets[30 * 88 + 48] = 0.9;
	for (let i = 40; i < 43; i++) input.frames[i * 88 + 48] = 0;
	const result = decodeBasicPitchNotes(input);
	assert.deepEqual(result.notes.map(({ startSample, durationSamples }) => ({ startSample, durationSamples })), [
		{ startSample: 768, durationSamples: 6912 }, { startSample: 7680, durationSamples: 10240 },
	]);
});

test('silence and short transient activations produce no MIDI notes', () => {
	assert.deepEqual(decodeBasicPitchNotes(activations()).notes, []);
	const input = activations(); note(input, 60, 5, 10);
	assert.deepEqual(decodeBasicPitchNotes(input).notes, []);
	const weak = activations();
	for (let i = 10; i < 50; i++) weak.frames[i * 88 + 79] = 0.35;
	assert.deepEqual(decodeBasicPitchNotes(weak).notes, [], 'weak overtones without a confident onset do not start a note');
});

test('window stitching keeps a long note continuous and does not accumulate timing drift', () => {
	assert.equal(basicPitchFrameSample(142), 36_164);
	assert.equal(basicPitchFrameSample(142 * 100), 3_616_400);
	const input = { ...activations(300), sampleCount: 80_000 }; note(input, 60, 5, 299);
	const result = decodeBasicPitchNotes(input);
	assert.equal(result.notes.length, 1);
	assert.equal(result.notes[0]!.startSample, 1280);
	assert.equal(result.notes[0]!.durationSamples, basicPitchFrameSample(299) - 1280);
});

test('chunked Basic Pitch decoding keeps onset lookahead across borrowed inference packets', () => {
	const input = { ...activations(300), sampleCount: 72_000 };
	note(input, 60, 5, 180);
	note(input, 69, 141, 245);
	input.onsets[142 * 88 + 39] = 0.86;
	input.onsets[143 * 88 + 39] = 0.96;
	const expected = decodeBasicPitchNotes(input);
	const decoder = createBasicPitchNoteDecoder(input.frameCount, input.sampleCount);
	let start = 0;
	for (const end of [1, 142, 143, 180, 284, 300]) {
		const frames = input.frames.slice(start * 88, end * 88);
		const onsets = input.onsets.slice(start * 88, end * 88);
		decoder.push(frames, onsets);
		frames.fill(0); onsets.fill(0);
		start = end;
	}
	assert.deepEqual(decoder.finish(), expected);
	assert.deepEqual(expected.notes.map(({ pitch, startSample }) => [pitch, startSample]), [
		[60, 1280], [69, 36096], [60, 36420],
	]);
});

test('tensor corruption, invalid note geometry and cancelled decoding fail closed', () => {
	const input = activations(); input.frames[0] = NaN;
	assert.throws(() => decodeBasicPitchNotes(input), /probabilit/iu);
	assert.throws(() => decodeBasicPitchNotes({ ...activations(), onsets: new Float32Array(1) }), /geometry/iu);
	const cancelled = new AbortController(); cancelled.abort();
	assert.throws(() => decodeBasicPitchNotes(activations(), cancelled.signal), { name: 'AbortError' });
	assert.throws(() => reviewMusicTranscriptionV1({ schemaVersion: 1, sampleRate: 22_050,
		sampleCount: 1000, notes: [{ pitch: 60, startSample: 900, durationSamples: 200, velocity: 100 }] }), /note/iu);
});
