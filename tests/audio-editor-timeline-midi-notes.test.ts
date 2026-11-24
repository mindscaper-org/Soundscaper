/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withClipLoop } from '../src/common/editor/audio-clip-loop.ts';
import { withMidiClipData } from '../src/common/editor/midi-model.ts';
import { projectTimelineMidiNotes } from '../src/common/editor/ui/timeline/timeline-midi-notes.ts';

const clip = {
	kind: 'audio', timelineStartFrame: 600, durationFrames: 400, sourceStartFrame: 100, sourceDurationFrames: 200,
	waveformStartFrame: 40, waveformEndFrame: 300,
};

const notes = [
	{ id: 'left-edge', pitch: 60, startFrame: 80, durationFrames: 50, velocity: 100, channel: 0 },
	{ id: 'inside', pitch: 64, startFrame: 160, durationFrames: 50, velocity: 100, channel: 0 },
	{ id: 'right-edge', pitch: 69, startFrame: 270, durationFrames: 60, velocity: 100, channel: 0 },
	{ id: 'outside', pitch: 127, startFrame: 300, durationFrames: 30, velocity: 100, channel: 0 },
];

test('timeline MIDI bars honor source trims, stretch, reversal and the viewport offset', () => {
	const midiClip = withMidiClipData({ ...clip, reversed: true }, { version: 1, notes });
	const preview = projectTimelineMidiNotes(midiClip);
	assert.ok(preview);
	assert.deepEqual(preview.spans, [
		{ pitch: 60, start: 340, end: 400 },
		{ pitch: 64, start: 180, end: 280 },
		{ pitch: 69, start: 0, end: 60 },
	]);
	assert.deepEqual([preview.windowStart, preview.windowLength, preview.pitchMin, preview.pitchMax], [40, 260, 60, 69]);
	assert.equal(projectTimelineMidiNotes(clip), null);
});

test('compact MIDI data uses one loop period and follows its phase in a scrolled clip', () => {
	const midiClip = withMidiClipData({ ...clip, opaqueExtensions: withClipLoop(null, { periodFrames: 100, offsetFrames: 25 }),
		waveformStartFrame: 80, waveformEndFrame: 350 }, { version: 1, notes }, true);
	const preview = projectTimelineMidiNotes(midiClip);
	assert.ok(preview);
	assert.deepEqual([preview.period, preview.windowStart, preview.windowLength], [100, 5, 270]);
	assert.deepEqual(preview.spans, [
		{ pitch: 60, start: 0, end: 15 },
		{ pitch: 64, start: 30, end: 55 },
		{ pitch: 69, start: 85, end: 100 },
	]);
});

test('timeline MIDI follows a musical warp across a tempo change', () => {
	const midiClip = withMidiClipData({ ...clip, anchor: 'musical', musicalStartBeat: 0, musicalExtent: 'beat', musicalDurationBeats: 2,
		timelineStartFrame: 0, durationFrames: 72_000, waveformStartFrame: 0, waveformEndFrame: 72_000,
		warpMap: { feature: 'audio-warp', points: [
			{ mode: 'forward', outer: { num: 0, den: 1 }, source: { num: 100, den: 1 } },
			{ mode: 'forward', outer: { num: 1, den: 1 }, source: { num: 160, den: 1 } },
			{ mode: 'forward', outer: { num: 2, den: 1 }, source: { num: 300, den: 1 } },
		] },
	}, { version: 1, notes: [{ ...notes[1]!, durationFrames: 70 }] });
	const preview = projectTimelineMidiNotes(midiClip, { sampleRate: 48_000, tempoMap: { mode: 'musical', events: [
		{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
		{ beat: { num: 1, den: 1 }, bpm: { num: 60, den: 1 } },
	] } });
	assert.deepEqual(preview?.spans, [{ pitch: 64, start: 24_000, end: 48_000 }]);
});
