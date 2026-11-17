/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { openMidiAudioRenderer } from '../src/common/editor/engine/midi-audio-renderer.ts';
import { chaseMidiAudioEvents } from '../src/common/editor/engine/midi-audio-events.ts';
import type { MidiClipData } from '../src/common/editor/midi-model.ts';

for (const future of [false, true]) test(`cold MIDI seeks retain held programs and subsequent patch changes, future note=${String(future)}`, async () => {
	const note = { id: 'held', channel: 0, pitch: 67, velocity: 100, startFrame: 0, durationFrames: 480000 };
	const data: MidiClipData = { version: 1, notes: [note, ...(future ? [{ ...note, id: 'future', pitch: 72, startFrame: 66536 }] : [])], interchange: { tempos: [], signatures: [], events: [
		{ frame: 0, status: 0xc0, data: [40] }, { frame: 12000, status: 0xc0, data: [80] },
	] } };
	const reference: MidiClipData = { ...data, notes: data.notes.map(value => value.id === 'future' ? { ...value, startFrame: 1000 } : value),
		interchange: { ...data.interchange!, events: [data.interchange!.events[0]!, { frame: 1, status: 0xc0, data: [80] }] } };
	const chased = await openMidiAudioRenderer(data, 'fluidsynth', 48000, 65536);
	const expected = await openMidiAudioRenderer(reference, 'fluidsynth', 48000);
	try {
		const actual = (await chased.render(65536, 8192))[0]!, pcm = (await expected.render(0, 8192))[0]!;
		const error = actual.reduce((maximum, sample, frame) => Math.max(maximum, Math.abs(sample - pcm[frame]!)), 0);
		assert.ok(pcm.some(sample => Math.abs(sample) > .01));
		assert.ok(error < 1e-6, `the held voice must retain program 40, error ${String(error)}`);
	} finally { await chased.close(); await expected.close(); }
});

test('chased voices retain committed banks while a pending bank remains available to the next program change', () => {
	const messages = [[0xb0, 0, 2], [0xc0, 10], [0x90, 60, 100], [0xb0, 0, 3], [0xc0, 20], [0x90, 67, 100], [0xb0, 0, 4]];
	const chased = chaseMidiAudioEvents(messages.map((data, frame) => ({ frame, data })), 100).map(event => event.data);
	assert.deepEqual(chased.slice(5), [
		[0xb0, 0, 2], [0xb0, 32, 0], [0xc0, 10], [0x90, 60, 100],
		[0xb0, 0, 3], [0xb0, 32, 0], [0xc0, 20], [0x90, 67, 100],
		[0xb0, 0, 4], [0xb0, 32, 0],
	]);
});
