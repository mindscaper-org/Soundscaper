/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { designSystemMidiClip, midiBeatsPerMeasure, midiNoteChanges } from '../src/common/editor/ui/workspace/midi-panel-projection.ts';
import type { EditorAudioClip } from '../src/common/editor/types.ts';

test('piano roll measures compound and eighth-note bars in the MIDI tempo quarter-note basis', () => {
	assert.equal(midiBeatsPerMeasure(), 4);
	assert.equal(midiBeatsPerMeasure({ numerator: 6, denominator: 8 }), 3);
	assert.equal(midiBeatsPerMeasure({ numerator: 3, denominator: 8 }), 1.5);
	assert.equal(midiBeatsPerMeasure({ numerator: 3, denominator: 4 }), 3);
});

test('piano roll preserves sample timing, trim and transient selection when projecting to design-system seconds', () => {
	const clip: EditorAudioClip = { kind: 'audio', id: 'clip', sourceId: 'source', title: 'Notes',
		timelineStartFrame: 96_000, sourceStartFrame: 24_000, sourceDurationFrames: 96_000, durationFrames: 72_000 };
	const projected = designSystemMidiClip(clip, 48_000, new Set(['first']), [
		{ id: 'first', pitch: 60, velocity: 96, startFrame: 24_000, durationFrames: 12_000, channel: 2 },
		{ id: 'second', pitch: 64, velocity: 80, startFrame: 48_000, durationFrames: 24_000, channel: 2 },
	]);
	assert.equal(projected.start, 2);
	assert.equal(projected.trimStart, 0.5);
	assert.equal(projected.duration, 1.5);
	assert.deepEqual(projected.notes, [
		{ id: 1, pitch: 60, velocity: 96, startTime: 0.5, duration: 0.25, selected: true },
		{ id: 2, pitch: 64, velocity: 80, startTime: 1, duration: 0.5, selected: false },
	]);
});

test('piano roll rounds edited note times once without leaking design-system selection or numeric ids into persisted events', () => {
	assert.deepEqual(midiNoteChanges({ id: 3, selected: true, pitch: 67, startTime: 1 / 3, duration: 0.125 }, 48_000), {
		pitch: 67, startFrame: 16_000, durationFrames: 6_000,
	});
	assert.deepEqual(midiNoteChanges({ startTime: -1, duration: 0 }, 48_000), { startFrame: 0, durationFrames: 1 });
});
