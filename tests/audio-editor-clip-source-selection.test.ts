/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { clipSourceSelection, clipSourceSelectionDisplay } from '../src/common/editor/ui/inspector/clip-source-selection.ts';
import type { ClipSourceTimingProject } from '../src/common/editor/clip-source-timing.ts';
const project: ClipSourceTimingProject = { sampleRate: 1000, tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] } };
const clip = { sourceStartFrame: 200, sourceDurationFrames: 200, timelineStartFrame: 800, durationFrames: 200, reversed: true };
const source = { sampleRate: 1000, frameCount: 1000 };

test('reversed source selections on either unused side exclude the clip at the seam', () => {
	assert.deepEqual(clipSourceSelection(project, clip, source, { startFrame: 100, endFrame: 200 }).source, { startFrame: 100, endFrame: 200 });
	assert.deepEqual(clipSourceSelection(project, clip, source, { startFrame: 400, endFrame: 500 }).source, { startFrame: 400, endFrame: 500 });
});
test('a selection inside reversed audio maps exactly to its selected source samples', () => {
	assert.deepEqual(clipSourceSelection(project, clip, source, { startFrame: 250, endFrame: 300 }).source, { startFrame: 300, endFrame: 350 });
});
test('crossing a reversed seam expands the visible selection to the contiguous source range before applying effects', () => {
	assert.deepEqual(clipSourceSelection(project, clip, source, { startFrame: 100, endFrame: 300 }), {
		display: { startFrame: 100, endFrame: 400 }, source: { startFrame: 100, endFrame: 400 },
	});
	assert.deepEqual(clipSourceSelection(project, clip, source, { startFrame: 300, endFrame: 500 }), {
		display: { startFrame: 200, endFrame: 500 }, source: { startFrame: 200, endFrame: 500 },
	});
});


for (const reversed of [false, true]) for (const selected of [
	{ startFrame: 100, endFrame: 200 }, { startFrame: 100, endFrame: 400 },
	{ startFrame: 250, endFrame: 300 }, { startFrame: 200, endFrame: 500 },
	{ startFrame: 400, endFrame: 500 },
]) test(`source result highlight represents the same native interval, reversed=${reversed}, ${JSON.stringify(selected)}`, () => {
	const current = { ...clip, reversed };
	const display = clipSourceSelectionDisplay(project, current, source, selected);
	assert.deepEqual(clipSourceSelection(project, current, source, display).source, selected);
});

for (const reversed of [false, true]) test(`source result highlight maps one retained loop period, reversed=${reversed}`, () => {
	const current = { ...clip, reversed, durationFrames: 600, opaqueExtensions: { 'org.soundscaper.clip-loop/v1': { periodFrames: 200, offsetFrames: 25 } } };
	for (const selected of [{ startFrame: 250, endFrame: 300 }, { startFrame: 200, endFrame: 400 }]) {
		const display = clipSourceSelectionDisplay(project, current, source, selected);
		assert.deepEqual(clipSourceSelection(project, current, source, display).source, selected);
	}
});


test('source result highlight uses the nonlinear warp inverse before publishing native selection', () => {
	const current = { ...clip, reversed: false, durationFrames: 600, warpMap: { feature: 'audio-warp' as const, points: [
		{ outer: 0, source: 200, mode: 'forward' as const },
		{ outer: 200, source: 250, mode: 'forward' as const },
		{ outer: 600, source: 400, mode: 'forward' as const },
	] } };
	for (const selected of [{ startFrame: 250, endFrame: 300 }, { startFrame: 200, endFrame: 400 }, { startFrame: 100, endFrame: 500 }]) {
		assert.deepEqual(clipSourceSelection(project, current, source, clipSourceSelectionDisplay(project, current, source, selected)).source, selected);
	}
});
