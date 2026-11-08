/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { renderMidiFrames } from '../src/common/editor/engine/midi-synthesis.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

function variable(value: number): number[] {
	const bytes = [value & 127];
	for (value = Math.floor(value / 128); value; value = Math.floor(value / 128)) bytes.unshift((value & 127) | 128);
	return bytes;
}

function panicMidi(delta: number, stopBefore = false): Uint8Array<ArrayBuffer> {
	const on = [0, 0x90, 69, 100], stop = [...variable(delta), 0xb0, 120, 0];
	const body = [0, 0xb0, 64, 127, ...(stopBefore ? [...stop, ...on] : [...on, ...stop]),
		...variable(16_384 - delta), 0xb0, 64, 0, 0, 255, 47, 0];
	return Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 127, 255,
		77, 84, 114, 107, 0, 0, 0, body.length, ...body]);
}

function lateEnergy(bytes: Uint8Array, instrument: 'triangle' | 'square'): number {
	return parseMidiFile(bytes).tracks.reduce((energy, track) => energy + renderMidiFrames(
		track.notes, instrument, 48_000, 512, 4096, track.events,
	).reduce((sum, value) => sum + value * value, 0), 0);
}

for (const delta of [0, 1, 2, 3, 8]) {
	for (const instrument of ['triangle', 'square'] as const) test(`MIDI tick rounding retains a later panic (${delta} source ticks, ${instrument})`, () => {
		const bytes = panicMidi(delta);
		const before = parseMidiFile(bytes);
		const note = before.tracks[0]?.notes[0]; assert.ok(note);
		assert.equal(note.onsetStop !== undefined, delta === 0);
		assert.equal(lateEnergy(bytes, instrument), 0);
		const output = writeMidiFile(before);
		assert.equal(lateEnergy(output, instrument), 0, 'tick rounding must not turn a stopped voice into a pedal-held tone');
		assert.equal(note.onsetStop !== undefined, delta === 0, 'delivery leaves authored source causality untouched');
	});
}

for (const instrument of ['triangle', 'square'] as const) test(`an earlier same-tick panic leaves the later ${instrument} note sounding`, () => {
	const bytes = panicMidi(0, true);
	assert.ok(lateEnergy(bytes, instrument) > 1);
	assert.ok(lateEnergy(writeMidiFile(parseMidiFile(bytes)), instrument) > 1);
});

test('public MIDI import and export do not create a sustained tone from a quantized panic', async () => {
	const f = midiServiceFixture({ sampleRate: 48_000 });
	await f.service.importDocument(parseMidiFile(panicMidi(1)));
	const source = f.pcm.get(f.project().clips[0]!.sourceId); assert.ok(source);
	assert.equal(source.reduce((sum, chunk) => sum + chunk.reduce((energy, value) => energy + value * value, 0), 0), 0);
	await f.service.exportFile('midi');
	const bytes = f.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
	assert.equal(lateEnergy(bytes, 'triangle'), 0);
});
