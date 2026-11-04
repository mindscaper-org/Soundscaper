/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { clipLoopUpdateFields } from '../src/common/editor/audio-clip-loop.ts';
import { createMidiClip, createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { midiDocumentFromProject } from '../src/common/editor/midi-project-interchange.ts';
import { midiClipOccurrences } from '../src/common/editor/midi-project-source-projection.ts';
import { evaluateAudioWarpMapAtSource } from '../src/common/editor/audio-warp-domain.ts';
import { roundRational } from '../src/common/editor/timeline-time.ts';

test('numeric Allegro import prepares tempo ordering without rebuilding every preceding declaration', () => {
	const count = 1024;
	const text = Array.from({ length: count }, (_, index) => `T${index / 4} -tempor:${90 + index % 60}\nT${index / 4} V0 P60 U0.1 L90`).join('\n');
	const { result, work } = countSortWork(() => parseAllegroFile(text));
	assert.equal(result.tempos.length, count);
	assert.equal(result.tracks[0]?.notes.length, count);
	assert.deepEqual(result.tracks[0]?.notes.at(-1), { id: 'allegro-0-1023', pitch: 60, channel: 0, velocity: 90, startFrame: 12_276_000, durationFrames: 4800 });
	assert.ok(work <= count * 4, `${work} tempo entries sorted for ${count} declarations`);
});

test('looped MIDI export prepares imported controller ordering once for all repeated source windows', () => {
	const count = 512;
	const events = Array.from({ length: count }, (_, index) => ({ frame: (count - index - 1) * 100, status: 0xb0, data: [1, index % 128] }));
	const clip = createMidiClip({ id: 'clip', sourceId: 'source', title: 'Imported', timelineStartFrame: 0,
		sourceStartFrame: 1000, sourceDurationFrames: 1000, durationFrames: 1000, notes: [], interchange: { events, tempos: [], signatures: [] } });
	assert.ok(typeof clip.durationFrames === 'number');
	const loop = { ...clip, ...clipLoopUpdateFields({ ...clip, durationFrames: clip.durationFrames }, { periodFrames: 1000, durationFrames: 16_000 }) };
	const track = createMidiTrack({ id: 'track', name: 'Imported', clipIds: ['clip'] });
	const { result, work } = countSortWork(() => midiDocumentFromProject({ sampleRate: 48_000, tracks: [{ ...track }], clips: [loop] }));
	assert.equal(result.tracks[0]?.events?.length, 16 * 11);
	assert.deepEqual(result.tracks[0]?.events?.slice(0, 3).map(event => [event.frame, event.data]), [[0, [1, 118]], [0, [1, 117]], [100, [1, 116]]]);
	assert.deepEqual(result.tracks[0]?.events?.slice(-2).map(event => event.frame), [15_800, 15_900]);
	assert.ok(work <= count * 2, `${work} imported controller entries sorted for 16 repeats`);
});

test('lazy Allegro tempo preparation stays fresh when numeric declarations and beat fields alternate', () => {
	const parsed = parseAllegroFile('T0 -tempor:120\nT1 -tempor:60\nTQ3 V0 P60 UQ1 L90\nT3 -tempor:120\nTQ6 V0 P62 UQ1 L90\n');
	assert.deepEqual(parsed.tempos, [{ frame: 0, bpm: 120 }, { frame: 48_000, bpm: 60 }, { frame: 144_000, bpm: 120 }]);
	assert.deepEqual(parsed.tracks[0]?.notes.map(note => [note.pitch, note.startFrame, note.durationFrames]), [[60, 96_000, 48_000], [62, 192_000, 24_000]]);
});

test('dense MIDI warp export retains exact rational source projection at boundaries and between anchors', () => {
	const points = Array.from({ length: 129 }, (_, index) => ({ outer: { num: index * 200 + (index === 128 ? 0 : index % 3 * 2), den: 1 }, source: { num: index * 100, den: 1 }, mode: 'forward' as const }));
	const map = { feature: 'audio-warp' as const, points };
	const clip = createMidiClip({ id: 'clip', sourceId: 'source', title: 'Warped', timelineStartFrame: 1000,
		sourceStartFrame: 0, sourceDurationFrames: 12_800, durationFrames: 25_600, notes: [], warpMap: map });
	const frames = [0, 100, 12_800, ...Array.from({ length: 64 }, (_, index) => 6401 + index * 97)];
	const expected = frames.map(frame => { const outer = evaluateAudioWarpMapAtSource(map, frame); return 1000 + roundRational(outer.num, outer.den, 'point'); });
	const occurrence = [...midiClipOccurrences({ sampleRate: 48_000, tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] } }, clip)][0]!;
	assert.deepEqual(frames.map(frame => occurrence.global(frame)), expected);
});

function countSortWork<Result>(operation: () => Result): { result: Result; work: number } {
	const original = Array.prototype.sort;
	let work = 0;
	Array.prototype.sort = function (compare) {
		if (this.length > 128) work += this.length;
		return original.call(this, compare);
	};
	try { return { result: operation(), work }; } finally { Array.prototype.sort = original; }
}
