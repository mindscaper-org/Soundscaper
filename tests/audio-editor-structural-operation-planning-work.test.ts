import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { planTrackAlignment, planTrackSort } from '../src/common/editor/controller/track-audio/internal/track-structural-operation-planner.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';

const PROJECT = createSoundscaperProject({ id: 'structural-work',
	sources: [{ id: 'source', storageKey: 'source', frameCount: 64, sampleRate: 48_000, channelCount: 1 }],
	tracks: Array.from({ length: 1_000 }, (_, index) => ({ id: `track-${index}`, name: `Track ${String(index).padStart(4, '0')}`, clipIds: [`clip-${index}`] })),
	clips: Array.from({ length: 1_000 }, (_, index) => ({ id: `clip-${index}`, sourceId: 'source', timelineStartFrame: index * 64,
		sourceStartFrame: 0, sourceDurationFrames: 64, durationFrames: 64 })) });

function measured<Value>(operation: () => Value) {
	let clipVisits = 0, trackVisits = 0;
	const original = Array.prototype.map;
	Array.prototype.map = function<T, R>(this: T[], transform: (value: T, index: number, array: T[]) => R, receiver?: unknown): R[] {
		return original.call(this, (value: T, index: number, array: T[]) => {
			if (this === PROJECT.clips) clipVisits++;
			if (this === PROJECT.tracks) trackVisits++;
			return transform.call(receiver, value, index, array);
		}) as R[];
	};
	try { return { value: operation(), clipVisits: () => clipVisits, trackVisits: () => trackVisits }; }
	finally { Array.prototype.map = original; }
}

test('multi-track alignment shares current clip, track and lock lookup preparation', () => {
	const selected = PROJECT.tracks.map(track => track.id);
	const result = measured(() => planTrackAlignment(PROJECT as unknown as ControllerProject, selected, 'start-zero'));
	assert.equal(result.value.transforms.length, 999);
	assert.ok(result.value.transforms.every(transform => transform.changes.timelineStartFrame === 0));
	assert.ok(result.clipVisits() <= 2_000, `${result.clipVisits()} clip index visits`);
	assert.ok(result.trackVisits() <= 5_000, `${result.trackVisits()} track/lock index visits`);
});

test('name sorting does not prepare unused clip timing', () => {
	const result = measured(() => planTrackSort(PROJECT as unknown as ControllerProject, 'name'));
	assert.deepEqual(result.value, []);
	assert.equal(result.clipVisits(), 0);
	assert.ok(result.trackVisits() <= 5_000);
});

test('nearly sorted track order emits only the necessary move with the same atomic document result', () => {
	const count = 500;
	const project = createSoundscaperProject({ id: 'nearly-sorted', tracks: Array.from({ length: count }, (_, index) => ({ id: `track-${index}`,
		name: `Track ${String(index === count - 2 ? count - 1 : index === count - 1 ? count - 2 : index).padStart(4, '0')}`, clipIds: [] })) });
	const commands = planTrackSort(project as unknown as ControllerProject, 'name');
	const expected = { type: 'track-node/move' as const, sequenceId: project.sequences[0]!.id,
		nodeId: `track-${count - 1}`, parentFolderId: null, index: count - 2 };
	assert.deepEqual(commands, [expected]);
	const options = { now: '2026-10-26T00:00:00.000Z' };
	const applied = applySoundscaperProjectCommand(project, { type: 'batch', commands }, options);
	assert.deepEqual(applied, applySoundscaperProjectCommand(project, expected, options));
	assert.equal(applied.tracks[count - 2]!.id, `track-${count - 1}`);
});
