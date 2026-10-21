/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateClipFadeAt } from '../src/common/editor/audio-clip-transition-gain.ts';
import { scheduleClipGain } from '../src/common/editor/engine/clip-gain.ts';
import { planSelectedClipFadeEdits } from '../src/common/editor/ui/timeline/selected-clip-fades.ts';

type Event = Readonly<{ value: number; time: number }>;
function param() {
	const events: Event[] = [];
	const api = { setValueAtTime(value: number, time: number) { events.push({ value, time }); return api; },
		linearRampToValueAtTime(value: number, time: number) { events.push({ value, time }); return api; } };
	return { audio: api as unknown as AudioParam, at(time: number) {
		let before = events[0]!;
		for (const after of events.slice(1)) {
			if (after.time < time) { before = after; continue; }
			return before.value + (after.value - before.value) * (time - before.time) / (after.time - before.time);
		}
		return before.value;
	} };
}

for (const edge of ['in', 'out'] as const) test(`a menu-authored S-curve fade ${edge} retains its quarter-point gain during playback`, () => {
	const original = { id: 'clip', kind: 'audio', timelineStartFrame: 0, durationFrames: 48_000 };
	const edits = planSelectedClipFadeEdits({ clips: [original], editedClipId: 'clip', selectedIds: ['clip'], sampleRate: 48_000,
		edit: { kind: 'length', edge, frames: 48_000 } });
	assert.equal(edits.length, 1);
	const clip = { ...original, sourceId: 'source', ...edits[0]!.changes };
	assert.equal(edge === 'in' ? clip.fadeInShape : clip.fadeOutShape, 2);
	const fadeIn = param(), fadeOut = param(), gain = param();
	scheduleClipGain(fadeIn.audio, fadeOut.audio, gain.audio, clip, 0, 48_000, 48_000, 0, 48_000);
	const actual = edge === 'in' ? fadeIn : fadeOut;
	for (const frame of [6000, 12_000, 18_000, 30_000, 36_000, 42_000]) {
		const expected = evaluateClipFadeAt(frame, 48_000, 48_000, edge, 2);
		assert.ok(Math.abs(actual.at(frame / 48_000) - expected) < 0.001, `The authored ${edge} gain differs at frame${String(frame)}.`);
	}
});
