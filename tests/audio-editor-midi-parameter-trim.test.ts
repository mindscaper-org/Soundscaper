/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import type { MidiFileEvent } from '../src/common/editor/midi-file-types.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

const control = (frame: number, controller: number, value: number): MidiFileEvent => ({ frame, status: 0xb0, data: [controller, value] });

async function trimmed(events: readonly MidiFileEvent[]) {
	const f = midiServiceFixture();
	const bytes = writeMidiFile({ sampleRate: 8000, tempos: [{ frame: 0, bpm: 120 }], signatures: [], tracks: [{ name: 'RPN tune', events,
		notes: [{ id: 'key', startFrame: 8000, durationFrames: 8000, pitch: 60, velocity: 100, channel: 0 }] }] });
	const created = await f.service.importDocument(parseMidiFile(bytes, { sampleRate: 8000 }));
	await f.service.resizeClip(created[0]!.clipId, { timelineStartFrame: 0, sourceStartFrame: 4000, durationFrames: 16_000 });
	return f;
}

test('trimmed MIDI and Allegro retain every relative RPN increment before the source edge', async () => {
	const setup = [control(0, 101, 0), control(0, 100, 0), control(0, 6, 12), control(0, 38, 0),
		control(1000, 96, 0), control(2000, 96, 0), { frame: 8000, status: 0xe0, data: [0, 96] }];
	const f = await trimmed(setup);
	for (const format of ['midi', 'allegro'] as const) {
		await f.service.exportFile(format);
		const saved = f.saves.at(-1)!;
		const document = format === 'midi' && saved.bytes instanceof Uint8Array
			? parseMidiFile(saved.bytes, { sampleRate: 8000 }) : parseAllegroFile(String(saved.text), { sampleRate: 8000 });
		const events = document.tracks.flatMap(track => track.events ?? []);
		assert.deepEqual(events.filter(event => event.status === 0xb0).map(event => event.data), setup.slice(0, -1).map(event => event.data));
		const range = events.filter(event => event.status === 0xb0).reduce((value, event) =>
			event.data[0] === 6 ? event.data[1]! : event.data[0] === 96 ? value + 1 : value, 2);
		assert.equal(range, 14, 'two Data Increment messages each add one semitone to the selected sensitivity');
	}
});

test('trimmed parameter setup retains earlier RPN and NRPN values before the final selection', async () => {
	const setup = [control(0, 101, 0), control(0, 100, 0), control(0, 6, 12), control(1000, 99, 1),
		control(1000, 98, 2), control(1000, 6, 40), control(2000, 97, 0), control(3000, 101, 127), control(3000, 100, 127)];
	const f = await trimmed(setup);
	await f.service.exportFile('midi');
	const bytes = f.saves[0]?.bytes;
	assert.ok(bytes instanceof Uint8Array);
	assert.deepEqual(parseMidiFile(bytes, { sampleRate: 8000 }).tracks.flatMap(track => track.events ?? [])
		.filter(event => event.status === 0xb0).map(event => event.data), setup.map(event => event.data));
});

for (const resets of [[1000, 3000], [1000], [3000]]) test(`trimmed parameter history retains reset boundaries at ${resets}`, async () => {
	const setup = [control(0, 101, 0), control(0, 100, 0), ...resets.map(frame => control(frame, 121, 0)), control(2000, 96, 0)]
		.sort((left, right) => left.frame - right.frame);
	const f = await trimmed(setup);
	for (const format of ['midi', 'allegro'] as const) {
		await f.service.exportFile(format);
		const saved = f.saves.at(-1)!;
		const document = format === 'midi' && saved.bytes instanceof Uint8Array
			? parseMidiFile(saved.bytes, { sampleRate: 8000 }) : parseAllegroFile(String(saved.text), { sampleRate: 8000 });
		assert.deepEqual(document.tracks.flatMap(track => track.events ?? []).filter(event => event.status === 176).map(event => event.data),
			setup.map(event => event.data), 'Reset All Controllers retires RPN/NRPN selection without clearing its previously assigned value');
	}
});
