/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

function file(events: readonly number[]): Uint8Array<ArrayBuffer> {
	const track = [...events, 0, 255, 47, 0];
	return Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224,
		77, 84, 114, 107, 0, 0, track.length >> 8, track.length & 255, ...track]);
}

async function exported(events: readonly number[]) {
	const f = midiServiceFixture();
	await f.service.importDocument(parseMidiFile(file(events), { sampleRate: 8000 }));
	await f.service.exportFile('midi');
	const bytes = f.saves[0]!.bytes;
	assert.ok(bytes instanceof Uint8Array);
	return { f, bytes };
}

function messageIndex(bytes: Uint8Array, message: readonly number[]): number {
	return bytes.findIndex((_value, index) => message.every((byte, offset) => bytes[index + offset] === byte));
}

test('MIDI export keeps a same-tick pedal press before key release, preserving the audible held tail', async () => {
	const { f, bytes } = await exported([0, 0x90, 60, 100,
		0x83, 0x60, 0xb0, 64, 127, 0, 0x80, 60, 0,
		0x83, 0x60, 0xb0, 64, 0]);
	const pcm = f.pcm.values().next().value;
	assert.ok(pcm);
	assert.ok(pcm[0]!.slice(5000, 6000).reduce((sum, value) => sum + value * value, 0) > 1,
		'the admitted original sounds after key release while sustain is held');
	const down = messageIndex(bytes, [0xb0, 64, 127]);
	const off = messageIndex(bytes, [0x80, 60, 0]);
	assert.ok(down >= 0 && off > down, 'the pedal must be down when the exported receiver releases the key');
});

test('same-tick channel setup and old key release remain before the retriggered note', async () => {
	const { bytes } = await exported([0, 0x90, 60, 100,
		0x83, 0x60, 0xb0, 123, 0, 0, 0x80, 60, 0, 0, 0x90, 60, 90,
		0x83, 0x60, 0x80, 60, 0]);
	const control = messageIndex(bytes, [0xb0, 123, 0]);
	const off = messageIndex(bytes, [0x80, 60, 0]);
	const on = messageIndex(bytes, [0x90, 60, 90]);
	assert.ok(control >= 0 && off > control && on > off,
		'All Notes Off and the old key release must not close the newly retriggered note');
	const reopened = parseMidiFile(bytes, { sampleRate: 8000 });
	assert.deepEqual(reopened.tracks.find(track => track.notes.length)?.notes.map(note => [note.startFrame, note.durationFrames]), [[0, 4000], [4000, 4000]]);
});

test('a multipart SysEx completion stays before a same-tick key release', async () => {
	const { bytes } = await exported([0, 0x90, 60, 100,
		0x81, 0x70, 0xf0, 3, 0x43, 0x12, 0,
		0x81, 0x70, 0xf7, 3, 0x43, 0, 0xf7, 0, 0x80, 60, 0]);
	const completion = messageIndex(bytes, [0xf7, 3, 0x43, 0, 0xf7]);
	const off = messageIndex(bytes, [0x80, 60, 0]);
	assert.ok(completion >= 0 && off > completion,
		'no transmittable key release may interrupt the open multipart message');
	assert.ok(parseMidiFile(bytes).tracks.some(track => track.notes.length === 1));
});
