/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createMidiRenderer, renderMidiFrames } from '../src/common/editor/engine/midi-synthesis.ts';
import { publishMidiSource } from '../src/common/editor/controller/track-audio/internal/midi-source-publication.ts';
import type { MidiServiceDependencies } from '../src/common/editor/controller/track-audio/midi-service-types.ts';
import type { MidiFileEvent } from '../src/common/editor/midi-file-types.ts';

test('MIDI source publication reads channel messages once across its PCM chunks', async () => {
	let statusReads = 0;
	const events: MidiFileEvent[] = Array.from({ length: 100 }, (_, index) => ({
		frame: index * 1900,
		get status() { statusReads += 1; return 0xb0; },
		data: [11, 80 + index % 40],
	}));
	let chunks = 0;
	const dependencies: MidiServiceDependencies = {
		getProject: () => null, editingBlocked: () => false, commit: () => undefined,
		createId: () => 'source', trackName: () => 'MIDI', clipName: () => 'MIDI',
		previewNote: async () => undefined, saveFile: () => undefined,
		store: { beginSourceWrite: async () => ({ write: () => { chunks += 1; },
			commit: () => undefined, abort: () => undefined }), deleteSource: async () => undefined },
	};
	await publishMidiSource(dependencies, { version: 1, notes: [
		{ id: 'held', pitch: 60, startFrame: 0, durationFrames: 200_000, velocity: 100, channel: 0 },
	], interchange: { events, tempos: [], signatures: [] } }, 'triangle', 8000, 200_000, () => undefined);
	assert.equal(chunks, 4);
	assert.ok(statusReads <= events.length * 4, `channel message reads grew with PCM chunks: ${statusReads}`);
});

test('prepared MIDI windows detach note geometry and retain independent random-access PCM', () => {
	let geometryReads = 0;
	const notes = [{ id: 'note', pitch: 69,
		get startFrame() { geometryReads += 1; return 100; },
		durationFrames: 900, velocity: 100, channel: 0 }];
	const events: MidiFileEvent[] = [{ frame: 500, status: 0xb0, data: [64, 127] },
		{ frame: 1800, status: 0xb0, data: [64, 0] }];
	const expected = renderMidiFrames(notes, 'square', 8000, 0, 2000, events);
	const render = createMidiRenderer(notes, 'square', 8000, events);
	geometryReads = 0;
	notes.length = 0;
	events.length = 0;
	for (const [start, count] of [[1500, 500], [0, 100], [1800, 200], [99, 903], [400, 1000]]) {
		assert.deepEqual(render(start!, count!), expected.slice(start, start! + count!));
	}
	assert.equal(geometryReads, 0, 'independent windows must reuse prepared note geometry');
	assert.throws(() => render(-1, 100), RangeError);
	assert.throws(() => render(0, 4_194_305), RangeError);
});

test('MIDI synthesis retains exact PCM for unsorted polyphony, expression and sounding note releases', () => {
	const notes = Array.from({ length: 128 }, (_, index) => ({
		id: `note-${index}`, pitch: 30 + index % 70, startFrame: index * 7193 % 180_000,
		durationFrames: 1000 + index % 11 * 813, velocity: 30 + index % 98, channel: index % 4,
	}));
	const events: MidiFileEvent[] = Array.from({ length: 100 }, (_, index) => ({ frame: index * 1900,
		status: 0xb0 | index % 4, data: index % 3 === 0 ? [64, index % 2 ? 0 : 127] : [index % 3 === 1 ? 7 : 11, 50 + index % 78] }));
	events.push({ frame: 100_000, status: 0xb0, data: [123, 0] }, { frame: 150_000, status: 0xb1, data: [120, 0] },
		{ frame: 21_000, status: 0xe2, data: [0, 94] }, { frame: 83_000, status: 0xe2, data: [0, 64] });
	const digests = {
		sine: '73f29574c598b4dcb598b00d95151d3cd3a917ce657355967074d51d969079a1',
		triangle: '11f62bde6554736719b810c2722ff0fefe93091cf69eccfef337224d654c7775',
		square: 'ad4e58a22c599529238e33c5bbb32dde22b7cf1925d3316288059c3331df71ba',
		sawtooth: '88a0a636a597640bb7ce777db5f41567ff44ae1e0ba10dd8ac09da35b254445b',
	};
	for (const instrument of ['sine', 'triangle', 'square', 'sawtooth'] as const) {
		const samples = renderMidiFrames(notes, instrument, 8000, 0, 200_000, events);
		const render = createMidiRenderer(notes, instrument, 8000, events);
		assert.equal(createHash('sha256').update(new Uint8Array(samples.buffer)).digest('hex'), digests[instrument]);
		for (const [start, count] of [[100_001, 17_911], [0, 18_003], [65_534, 34_467]]) {
			assert.deepEqual(renderMidiFrames(notes, instrument, 8000, start!, count!, events), samples.slice(start, start! + count!));
			assert.deepEqual(render(start!, count!), samples.slice(start, start! + count!));
		}
	}
});
