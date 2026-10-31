/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMidiFrames } from '../src/common/editor/engine/midi-synthesis.ts';

const note = { id: 'note', pitch: 69, startFrame: 100, durationFrames: 1000, velocity: 100, channel: 0 };

test('MIDI synthesis renders silence outside the note and stable PCM across chunk boundaries', () => {
	const whole = renderMidiFrames([note], 'sine', 48_000, 0, 1500);
	assert.ok(whole.slice(0, 100).every(value => value === 0));
	assert.ok(whole.slice(1100).every(value => value === 0));
	assert.ok(whole.some(value => Math.abs(value) > 0.01));
	const joined = new Float32Array(1500);
	joined.set(renderMidiFrames([note], 'sine', 48_000, 0, 617));
	joined.set(renderMidiFrames([note], 'sine', 48_000, 617, 883), 617);
	assert.deepEqual(joined, whole);
});

test('polyphonic synthesis applies velocity, waveform choice and bounded output', () => {
	const quiet = renderMidiFrames([{ ...note, velocity: 30 }], 'sine', 48_000, 100, 900);
	const loud = renderMidiFrames([note], 'sine', 48_000, 100, 900);
	const square = renderMidiFrames([note], 'square', 48_000, 100, 900);
	const energy = (values: Float32Array) => values.reduce((sum, value) => sum + value * value, 0);
	assert.ok(energy(loud) > energy(quiet));
	assert.notDeepEqual(square, loud);
	const chord = renderMidiFrames(Array.from({ length: 128 }, (_, pitch) => ({ ...note, id: String(pitch), pitch })), 'sawtooth', 48_000, 100, 900);
	assert.ok(chord.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
});

test('invalid synthesis geometry is rejected before allocating samples', () => {
	assert.throws(() => renderMidiFrames([], 'sine', 0, 0, 100), RangeError);
	assert.throws(() => renderMidiFrames([], 'sine', 48_000, -1, 100), RangeError);
	assert.throws(() => renderMidiFrames([], 'sine', 48_000, 0, Number.MAX_SAFE_INTEGER), RangeError);
});
