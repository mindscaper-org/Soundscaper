/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createMidiPerformanceStateProjection } from '../src/common/editor/midi-project-performance-state.ts';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import type { MidiFileEvent } from '../src/common/editor/midi-file-types.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

test('reversed repeats scan their source performance history once per bounded window', () => {
	const events: MidiFileEvent[] = Array.from({ length: 5000 }, (_, index) => ({ frame: index * 64, status: 176, data: [7, index % 128] }));
	let visits = 0;
	Object.defineProperty(events, Symbol.iterator, { value: function* () {
		for (let index = 0; index < events.length; index += 1) { visits += 1; yield events[index]!; }
	} });
	const projection = createMidiPerformanceStateProjection(events);
	for (let repeat = 0; repeat < 400; repeat += 1) {
		const output = projection.reversed(320_000, 4000, repeat * 4000, frame => repeat * 4000 + 324_000 - frame);
		assert.deepEqual(output, [{ frame: repeat * 4000, status: 176, data: [7, 7] }]);
	}
	assert.equal(visits, events.length * 2, 'one defaults scan and one source-window scan');
	for (const start of [320_001, 320_002]) projection.reversed(start, 4000, 0, frame => start + 4000 - frame);
	const cached = visits;
	for (const start of [320_000, 320_001, 320_002]) projection.reversed(start, 4000, 0, frame => start + 4000 - frame);
	assert.equal(visits, cached);
	for (let repeat = 0; repeat < 2; repeat += 1) projection.reversed(320_003, 4000, 0, frame => 324_003 - frame);
	assert.equal(visits, cached + events.length * 2, 'a fourth distinct window is not retained');
});

test('cached reverse states map each occurrence independently across controls and channels', () => {
	const events: MidiFileEvent[] = [
		{ frame: 0, status: 178, data: [7, 30] }, { frame: 100, status: 178, data: [11, 40] },
		{ frame: 110, status: 178, data: [64, 127] }, { frame: 120, status: 226, data: [0, 96] },
		{ frame: 130, status: 179, data: [7, 50] }, { frame: 150, status: 178, data: [121, 0] },
	];
	const projection = createMidiPerformanceStateProjection(events);
	const initial = projection.reversed(100, 100, 0, frame => 200 - frame);
	assert.deepEqual(initial, [
		{ frame: 0, status: 178, data: [7, 30] }, { frame: 0, status: 178, data: [11, 127] },
		{ frame: 0, status: 178, data: [64, 0] }, { frame: 0, status: 226, data: [0, 64] },
		{ frame: 0, status: 179, data: [7, 50] },
		{ frame: 50, status: 226, data: [0, 96] }, { frame: 50, status: 178, data: [64, 127] },
		{ frame: 50, status: 178, data: [11, 40] }, { frame: 70, status: 179, data: [7, 127] },
		{ frame: 80, status: 226, data: [0, 64] }, { frame: 90, status: 178, data: [64, 0] },
		{ frame: 100, status: 178, data: [11, 127] },
	]);
	assert.deepEqual(projection.reversed(100, 100, 1000, frame => 1000 + (200 - frame) * 2),
		initial.map(event => ({ ...event, frame: event.frame === 0 ? 1000 : 1000 + event.frame * 2 })));
});

test('a public imported, trimmed, reversed 10000-period clip retains exact delivered MIDI bytes', async () => {
	const fixture = midiServiceFixture();
	const events: MidiFileEvent[] = Array.from({ length: 5000 }, (_, index) => ({ frame: index * 64, status: 176, data: [7, index === 4999 ? 80 : index % 128] }));
	await fixture.service.importDocument(parseMidiFile(writeMidiFile({ sampleRate: 8000, tempos: [{ frame: 0, bpm: 120 }], signatures: [],
		tracks: [{ name: 'Recorded fader and note', durationFrames: 324_000, notes: [{ id: 'n', startFrame: 320_000,
			durationFrames: 4000, pitch: 60, velocity: 90, channel: 0 }], events }] }), { sampleRate: 8000 }));
	const clip = fixture.project().clips[0];
	assert.ok(clip);
	fixture.apply({ type: 'clip/trim', clipId: clip.id, sourceStartFrame: 320_000, sourceDurationFrames: 4000, durationFrames: 4000 });
	fixture.apply({ type: 'clip/update', clipId: clip.id, changes: { reversed: true, loop: { periodFrames: 4000, durationFrames: 40_000_000 } } });
	assert.ok(validateAudioEditorProjectV17(fixture.project()));
	await fixture.service.exportFile('midi');
	const bytes = fixture.saves[0]?.bytes;
	assert.ok(bytes instanceof Uint8Array);
	assert.equal(bytes.length, 130_080);
	assert.equal(createHash('sha256').update(bytes).digest('hex'), '7dbcafbcd9583684be02fd6941db2e27c9d3d3cabd8fd3d250d0ec74168f82cb');
});
