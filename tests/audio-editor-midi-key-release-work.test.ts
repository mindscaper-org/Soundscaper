/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { midiFileNoteReleases } from '../src/common/editor/midi-file-note-releases.ts';

for (const overlapping of [false, true]) test(`MIDI key release work stays bounded for overlapping=${overlapping}`, () => {
	const count = 10_000;
	const original = Array.prototype.splice;
	let moved = 0;
	Array.prototype.splice = function (...args) {
		if (args[1] === 1 && this.length > 128) moved += this.length - args[0] - 1;
		return Reflect.apply(original, this, args);
	};
	try {
		const document = parseMidiFile(keyFile(count, overlapping));
		assert.equal(document.tracks[0]?.notes.length, count);
		assert.ok(document.tracks[0]?.notes.every(note => note.pitch === 60 && note.releaseVelocity === 64));
		assert.ok(moved <= count * 16, `${moved} array entries shifted while releasing ${count} keys`);
	} finally { Array.prototype.splice = original; }
});

test('interior track-local releases preserve the remaining global FIFO and channel-mode keys', () => {
	const first = { tick: 0, status: 144, data: [60, 90] };
	const second = { tick: 20, status: 144, data: [60, 80] };
	const other = { tick: 5, status: 144, data: [60, 70] };
	const afterPanic = { tick: 50, status: 144, data: [60, 60] };
	const held = { tick: 40, status: 144, data: [60, 50] };
	const result = midiFileNoteReleases([
		{ events: [first, second, { tick: 30, status: 128, data: [60, 71] }, held, afterPanic] },
		{ events: [other, { tick: 25, status: 128, data: [60, 81] }] },
		{ events: [{ tick: 35, status: 128, data: [60, 91] }, { tick: 45, status: 176, data: [123, 0] },
			{ tick: 55, status: 144, data: [60, 0] }] },
	]);
	assert.deepEqual(result.get(first), { tick: 30, velocity: 71 });
	assert.deepEqual(result.get(other), { tick: 25, velocity: 81 });
	assert.deepEqual(result.get(second), { tick: 35, velocity: 91 });
	assert.equal(result.get(held)?.allNotesOff?.soundEndTick, 45);
	assert.deepEqual(result.get(afterPanic), { tick: 55, velocity: 64 });
});

function keyFile(count: number, overlapping: boolean): Uint8Array {
	const body = [0, 255, 81, 3, 7, 161, 32];
	if (overlapping) {
		for (let index = 0; index < count; index += 1) body.push(0, 144, 60, 90);
		for (let index = 0; index < count; index += 1) body.push(index === 0 ? 1 : 0, 128, 60, 64);
	} else for (let index = 0; index < count; index += 1) body.push(0, 144, 60, 90, 1, 128, 60, 64);
	body.push(0, 255, 47, 0);
	const header = [77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 127, 255, 77, 84, 114, 107];
	const bytes = new Uint8Array(header.length + 4 + body.length);
	bytes.set(header); new DataView(bytes.buffer).setUint32(header.length, body.length); bytes.set(body, header.length + 4);
	return bytes;
}
