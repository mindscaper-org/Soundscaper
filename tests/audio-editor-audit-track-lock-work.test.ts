/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';

function measureSnapshots(run: () => void) {
	const find = Array.prototype.find, filter = Array.prototype.filter;
	const visits = { relationships: 0, locations: 0, tracks: 0 };
	function measured(this: unknown[], predicate: (value: unknown, index: number, values: unknown[]) => unknown,
		receiver: unknown, original: typeof find | typeof filter, method: 'find' | 'filter') {
		const stack = new Error().stack ?? '';
		const key = stack.includes('relatedMemberships') ? 'relationships'
			: stack.includes('trackLocations') ? 'locations'
				: method === 'find' && stack.includes('protectedTrackSnapshot') ? 'tracks' : null;
		return Reflect.apply(original, this, [key ? (value: unknown, index: number, values: unknown[]) => {
			visits[key]++; return predicate.call(receiver, value, index, values);
		} : predicate, receiver]) as unknown;
	}
	Object.defineProperty(Array.prototype, 'find', { configurable: true, writable: true,
		value(this: unknown[], predicate: (value: unknown, index: number, values: unknown[]) => unknown, receiver?: unknown) {
			return measured.call(this, predicate, receiver, find, 'find');
		} });
	Object.defineProperty(Array.prototype, 'filter', { configurable: true, writable: true,
		value(this: unknown[], predicate: (value: unknown, index: number, values: unknown[]) => unknown, receiver?: unknown) {
			return measured.call(this, predicate, receiver, filter, 'filter');
		} });
	try { run(); } finally {
		Object.defineProperty(Array.prototype, 'find', { configurable: true, writable: true, value: find });
		Object.defineProperty(Array.prototype, 'filter', { configurable: true, writable: true, value: filter });
	}
	return visits;
}

test('renaming a project with one locked track indexes its many clip relationships', () => {
	const count = 500;
	const clips = Array.from({ length: count }, (_, index) => [0, 1].map(side => ({
		id: `c${index}-${side}`, sourceId: 'source', groupId: `g${index}`, sourceStartFrame: 0,
		sourceDurationFrames: 64, durationFrames: 64, timelineStartFrame: index * 64,
	}))).flat();
	const project = createSoundscaperProject({ id: 'locked-groups',
		sources: [{ id: 'source', storageKey: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 64 }], clips,
		tracks: [0, 1].map(side => ({ id: `t${side}`, locked: side === 0,
			clipIds: clips.filter(clip => clip.id.endsWith(`-${side}`)).map(clip => clip.id) })),
	});
	const visits = measureSnapshots(() => {
		const renamed = applySoundscaperProjectCommand(project, { type: 'project/rename', title: 'Renamed' });
		assert.equal(renamed.title, 'Renamed');
		assert.deepEqual(renamed.clips, project.clips);
	});
	assert.ok(visits.relationships <= clips.length * 8, `${visits.relationships} relationship predicates`);
});

test('renaming a project with many locked tracks indexes their hierarchy once per command stage', () => {
	const count = 500;
	const project = createSoundscaperProject({ id: 'locked-locations',
		tracks: Array.from({ length: count }, (_, index) => ({ id: `t${index}`, locked: true, clipIds: [] })),
	});
	const visits = measureSnapshots(() => {
		const renamed = applySoundscaperProjectCommand(project, { type: 'project/rename', title: 'Renamed' });
		assert.equal(renamed.title, 'Renamed');
		assert.ok(renamed.tracks.every(track => track.locked));
	});
	assert.ok(visits.tracks <= count * 8, `${visits.tracks} track predicates`);
	assert.ok(visits.locations <= count * 8, `${visits.locations} hierarchy predicates`);
});
