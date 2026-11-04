/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { renderMidiFrames } from '../src/common/editor/engine/midi-synthesis.ts';
import { publishMidiSource } from '../src/common/editor/controller/track-audio/internal/midi-source-publication.ts';
import type { MidiServiceDependencies } from '../src/common/editor/controller/track-audio/midi-service-types.ts';
import type { MidiFileEvent } from '../src/common/editor/midi-file-types.ts';

const RATE = 48_000;
const note = { id: 'note', pitch: 69, startFrame: 0, durationFrames: 1_000, velocity: 100, channel: 0 };
const cc = (frame: number, controller: number, value: number, channel = 0): MidiFileEvent => ({ frame, status: 0xb0 | channel, data: [controller, value] });
const energy = (samples: Float32Array) => samples.reduce((sum, sample) => sum + sample * sample, 0);

test('MIDI sustain holds key-release notes until pedal up and sound-off controllers stop held notes', () => {
	const events = [cc(500, 64, 127), cc(2_000, 64, 0)];
	const sustained = renderMidiFrames([note], 'sine', RATE, 0, 2_500, events);
	assert.ok(energy(sustained.slice(1_100, 1_600)) > 1);
	assert.ok(sustained.slice(2_000).every(value => value === 0));
	for (const stop of [120, 121]) {
		const stopped = renderMidiFrames([note], 'sine', RATE, 0, 2_500, [...events, cc(1_500, stop, 0)]);
		assert.ok(energy(stopped.slice(1_100, 1_400)) > 0);
		assert.ok(stopped.slice(1_500).every(value => value === 0));
	}
	assert.deepEqual(note, { id: 'note', pitch: 69, startFrame: 0, durationFrames: 1_000, velocity: 100, channel: 0 });
});

test('All Notes Off respects sustain and leaves later notes and other channels sounding', () => {
	const held = { ...note, durationFrames: 3_000 };
	const events = [cc(500, 64, 127), cc(1_500, 123, 0), cc(2_200, 64, 0)];
	const sustained = renderMidiFrames([held], 'sine', RATE, 0, 3_000, events);
	assert.ok(energy(sustained.slice(1_600, 2_000)) > 1);
	assert.ok(sustained.slice(2_200).every(value => value === 0));
	const released = renderMidiFrames([held], 'sine', RATE, 0, 3_000, [cc(1_500, 123, 0)]);
	assert.ok(released.slice(1_500).every(value => value === 0));
	for (const independent of [{ ...held, channel: 1 }, { ...held, startFrame: 1_600, durationFrames: 1_400 }]) {
		const rendered = renderMidiFrames([independent], 'sine', RATE, 0, 3_000, events);
		assert.ok(energy(rendered.slice(2_300, 2_800)) > 1);
	}
});

test('MIDI pitch bend changes frequency while preserving the accumulated oscillator phase', () => {
	const held = { ...note, durationFrames: 9_600 };
	const events: MidiFileEvent[] = [{ frame: 2_400, status: 0xe0, data: [127, 127] }];
	const rendered = renderMidiFrames([held], 'sine', RATE, 0, 9_600, events);
	const ratio = 2 ** (((16_383 - 8_192) / 8_192 * 2) / 12);
	const frame = 3_001;
	const phase = (2_400 + (frame - 2_400) * ratio) * 440 / RATE;
	const expected = Math.tanh(Math.sin(phase * 2 * Math.PI) * (100 / 127) * 0.18);
	assert.ok(Math.abs(rendered[frame]! - expected) < 1e-6);
	const before = renderMidiFrames([held], 'sine', RATE, 0, 2_400);
	assert.deepEqual(rendered.slice(0, 2_400), before);
});

test('MIDI channel volume and expression apply independently and reset restores expression and bend', () => {
	const held = { ...note, durationFrames: 5_000 };
	const expression = [cc(1_000, 11, 0), cc(2_000, 121, 0)];
	const rendered = renderMidiFrames([held], 'sine', RATE, 0, 5_000, expression);
	assert.ok(rendered.slice(1_000, 2_000).every(value => value === 0));
	assert.ok(energy(rendered.slice(2_000, 3_000)) > 1);
	const volume = renderMidiFrames([held], 'sine', RATE, 0, 5_000, [cc(0, 7, 0), cc(2_000, 121, 0)]);
	assert.ok(volume.every(value => value === 0));
	const otherChannel = renderMidiFrames([{ ...held, channel: 1 }], 'sine', RATE, 0, 5_000, [cc(0, 7, 0)]);
	assert.ok(energy(otherChannel) > 1);
	const resetPitch = renderMidiFrames([held], 'sine', RATE, 0, 5_000, [
		cc(0, 7, 80), { frame: 0, status: 0xe0, data: [0, 96] }, cc(2_400, 121, 0),
	]);
	const ratio = 2 ** (1 / 12);
	const phase = (2_400 * ratio + (3_001 - 2_400)) * 440 / RATE;
	const expected = Math.tanh(Math.sin(phase * 2 * Math.PI) * (100 / 127) * 0.18 * (80 / 127));
	assert.ok(Math.abs(resetPitch[3_001]! - expected) < 1e-6);
});

test('sustain and expressive MIDI events produce identical PCM for independently rendered windows', () => {
	const events: MidiFileEvent[] = [
		cc(0, 7, 80), cc(500, 64, 127), { frame: 800, status: 0xe0, data: [0, 100] },
		cc(1_200, 11, 70), { frame: 1_400, status: 0xe0, data: [0, 64] }, cc(2_200, 64, 0),
	];
	const whole = renderMidiFrames([note], 'triangle', RATE, 0, 3_000, events);
	const chunks = new Float32Array(3_000);
	for (const [start, count] of [[0, 617], [617, 791], [1_408, 1_592]]) {
		chunks.set(renderMidiFrames([note], 'triangle', RATE, start!, count!, events), start!);
	}
	assert.deepEqual(chunks, whole);
	assert.ok(energy(whole.slice(1_100, 2_000)) > 0);
});

test('stored MIDI source chunks retain sustain and extend through auxiliary tempo and signature events', async () => {
	const chunks: Float32Array[] = [];
	const dependencies: MidiServiceDependencies = {
		getProject: () => null, editingBlocked: () => false, commit: () => undefined,
		createId: () => 'source', trackName: () => 'MIDI', clipName: () => 'MIDI',
		store: { beginSourceWrite: async () => ({ write: channels => { chunks.push(channels[0]!); },
			commit: () => undefined, abort: () => undefined }), deleteSource: async () => undefined },
		previewNote: async () => undefined, saveFile: () => undefined,
	};
	const events = [cc(500, 64, 127), cc(70_000, 64, 0)];
	const source = await publishMidiSource(dependencies, { version: 1, notes: [note], interchange: {
		events, tempos: [{ frame: 72_000, bpm: 90 }], signatures: [{ frame: 73_000, numerator: 3, denominator: 4 }],
	} }, 'sine', 8_000, 8_000, () => undefined);
	assert.equal(source.frameCount, 73_001);
	assert.equal(chunks.length, 2);
	const stored = new Float32Array(source.frameCount);
	let offset = 0;
	for (const chunk of chunks) { stored.set(chunk, offset); offset += chunk.length; }
	assert.deepEqual(stored, renderMidiFrames([note], 'sine', 8_000, 0, source.frameCount, events));
	assert.ok(energy(stored.slice(60_000, 61_000)) > 1);
});

test('MIDI source cleanup deletes staged media even when abort throws synchronously', async () => {
	const failure = new Error('Project changed');
	const abortFailure = new Error('Abort failed');
	let deleted = false;
	const dependencies: MidiServiceDependencies = {
		getProject: () => null, editingBlocked: () => false, commit: () => undefined,
		createId: () => 'source', trackName: () => 'MIDI', clipName: () => 'MIDI',
		store: { beginSourceWrite: async () => ({ write: () => undefined,
			commit: () => undefined, abort: () => { throw abortFailure; } }),
			deleteSource: async () => { deleted = true; } },
		previewNote: async () => undefined, saveFile: () => undefined,
	};
	await assert.rejects(publishMidiSource(dependencies, { version: 1, notes: [note] }, 'sine', RATE, RATE,
		() => { throw failure; }), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [failure, abortFailure]);
		assert.equal(error.cause, failure);
		return true;
	});
	assert.equal(deleted, true);
});
