/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createIndexedBeatFrameProjector, createIndexedTempoClock } from '../src/common/editor/indexed-tempo-projector.ts';
import { beatToSampleFrame, secondsToSampleFrame, type HoldTempoMap } from '../src/common/editor/timeline-time.ts';
import { createCurrentAudioEditorProject, validateCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

const musical: HoldTempoMap = { mode: 'musical', events: [
	{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
	{ beat: { num: 8, den: 1 }, bpm: { num: 60, den: 1 } },
] };

test('continuous source time retains fractions of a project sample in both directions', () => {
	const clock = createIndexedTempoClock(musical, 8_000);
	assert.ok(Object.isFrozen(clock));
	assert.equal(clock.beatAtTime(1 / 16_000), 1 / 8_000);
	assert.equal(clock.timeAtBeat(.250125), .1250625);
	for (const seconds of [4.5, 1 / 16_000, 20.25, 0, 2.125]) {
		assert.equal(clock.timeAtBeat(clock.beatAtTime(seconds)), seconds);
	}
});

test('sample-locked clock events remain active at their authoritative sample positions', () => {
	const sampleLocked: HoldTempoMap = { mode: 'sampleLocked', events: musical.events.map(event => ({ ...event,
		samplePosition: secondsToSampleFrame(event.beat.num === 0 ? 0 : 4, 8_000) })) };
	const first = createIndexedTempoClock(musical, 8_000), second = createIndexedTempoClock(sampleLocked, 8_000);
	for (const seconds of [0, .0000625, 3.9999375, 4, 4.1250625, 9]) {
		assert.equal(second.beatAtTime(seconds), first.beatAtTime(seconds));
		assert.equal(second.timeAtBeat(first.beatAtTime(seconds)), seconds);
	}
});

test('indexed frame callers retain point rounding and exact-frame admission', () => {
	const project = createIndexedBeatFrameProjector(musical, 8_000);
	for (const beat of [0, .250125, 7.99, 8, 8.125, 16.125]) assert.equal(project(beat), beatToSampleFrame(beat, musical, 8_000));
	assert.equal(project(.250125), 1001);
	assert.throws(() => createIndexedBeatFrameProjector(musical, 8_000, { requireExact: true })(.250125), /exact sample frame/u);
});

test('the prepared clock detaches event facts and rejects invalid elapsed seconds', () => {
	const input = structuredClone(musical);
	const clock = createIndexedTempoClock(input, 48_000);
	Reflect.set(input.events[0]!.bpm, 'num', 30);
	assert.equal(clock.timeAtBeat(4), 2);
	for (const seconds of [-1, Number.NaN, Infinity]) assert.throws(() => clock.beatAtTime(seconds), RangeError);
});

for (const count of [100, 200]) test(`${count} admitted rational tempo events retain a finite continuous clock`, () => {
	const tempoMap: HoldTempoMap = { mode: 'musical', events: Array.from({ length: count }, (_, index) => ({
		beat: { num: index, den: 1 }, bpm: { num: 10_001 + index, den: 100 },
	})) };
	const project = createCurrentAudioEditorProject({ id: `tempo-${count}`, sampleRate: 8_000, tempoMap });
	assert.equal(validateCurrentAudioEditorProject(project), true);
	const seconds = createIndexedTempoClock(tempoMap, 8_000).timeAtBeat(count);
	assert.ok(Number.isFinite(seconds), 'accumulated exact fractions must not overflow their floating conversion');
	assert.equal(Math.round(seconds * 8_000), createIndexedBeatFrameProjector(tempoMap, 8_000)(count));
});
