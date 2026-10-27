/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { createFramescaperImageBatchPlacementTimelineImage } from '../src/framescaper/editor-image-placement-timeline-image.ts';
import { createFramescaperProjectBinVisualActions } from '../src/framescaper/editor-project-bin-visual-actions.ts';
import { generatorCatalog, freezeCatalog, profile } from './helpers/framescaper-catalog-work-fixtures.ts';

const COUNT = 200;
let shared: ReturnType<typeof generatorCatalog> | undefined;
function selectedProject() {
	if (!shared) {
		const project = generatorCatalog(COUNT);
		shared = freezeCatalog(applyFramescaperProjectCommand(profile, project, { type: 'selection/set', startFrame: 0, endFrame: 48_000,
			trackIds: project.tracks.map(track => String(track.id)), clipIds: project.clips.map(clip => String(clip.id)) }));
	}
	return shared;
}

test('actual occupied image placement examines each candidate track own clip inventory', () => {
	const project = selectedProject(), some = Array.prototype.some;
	let visits = 0;
	Array.prototype.some = function<T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, receiver?: unknown): boolean {
		if (this.length !== COUNT || (this[0] as { id?: unknown })?.id !== 'visual-0' || !new Error().stack?.includes('rangeIsClear')) return some.call(this, predicate, receiver);
		return some.call(this, (value: T, index: number, array: T[]) => { visits++; return predicate.call(receiver, value, index, array); });
	};
	try {
		const placement = createFramescaperImageBatchPlacementTimelineImage(project, { sequenceStartFrame: 0, sequenceFrameCounts: [10], createId: () => 'new-image-track' });
		assert.equal(placement.trackId, 'new-image-track');
		assert.equal(placement.trackCommand?.type, 'track/add');
		assert.deepEqual(placement.placements, [{ sequenceStartFrame: 0, sequenceFrameCount: 10 }]);
		assert.ok(visits <= COUNT * 2, `${visits} complete clip-catalog placement predicates`);
	} finally { Array.prototype.some = some; }
});

test('one clicked selected visual clip moves every selected participant with exact expected ownership', () => {
	const project = selectedProject();
	let command: unknown;
	const actions = createFramescaperProjectBinVisualActions({ project, getSnapshot: () => ({ selectedClipId: 'visual-0' }),
		getTelemetrySnapshot: () => ({ positionFrame: 0 }), selectClips() {}, actions: { projectBin: {}, edit: { commit(value) { command = value; } } } });
	const map = Array.prototype.map, find = Array.prototype.find;
	let visits = 0;
	Array.prototype.map = function<T, R>(this: T[], callback: (value: T, index: number, array: T[]) => R, receiver?: unknown): R[] {
		if (this !== project.tracks || !new Error().stack?.includes('editor-project-bin-visual-actions')) return map.call(this, callback, receiver) as R[];
		return map.call(this, (value: T, index: number, array: T[]) => { visits++; return callback.call(receiver, value, index, array); }) as R[];
	};
	Array.prototype.find = function<T>(this: T[], callback: (value: T, index: number, array: T[]) => unknown, receiver?: unknown): T | undefined {
		if (this.length !== COUNT || (this[0] as { id?: unknown })?.id !== 'track-0' || !new Error().stack?.includes('editor-project-bin-visual-actions')) return find.call(this, callback, receiver);
		return find.call(this, (value: T, index: number, array: T[]) => { visits++; return callback.call(receiver, value, index, array); });
	};
	try {
		assert.deepEqual(actions.moveFromTimeline('visual-0'), project.clips.map(clip => clip.id));
		assert.ok(command && typeof command === 'object' && 'commands' in command && Array.isArray(command.commands));
		assert.deepEqual((command.commands as readonly unknown[]).slice(1), project.clips.map((clip, index) => ({
			type: 'video-visual-clip/set', clipId: clip.id, expectedClip: clip,
			expectedPlacement: { scope: 'timeline', trackId: `track-${index}` }, clip, placement: { scope: 'project-bin' },
		})));
		assert.ok(visits <= COUNT * 3, `${visits} track admission/owner predicates`);
	} finally { Array.prototype.map = map; Array.prototype.find = find; }
});

test('removing a visual source from its bin menu shares owner admission for all its timeline instances', () => {
	const base = selectedProject();
	const project = applyFramescaperProjectCommand(profile, base, { type: 'video-visual-clip/set', clipId: 'bin-visual',
		expectedClip: null, expectedPlacement: null, clip: { ...base.clips[0], id: 'bin-visual' }, placement: { scope: 'project-bin' } });
	let command: unknown;
	const actions = createFramescaperProjectBinVisualActions({ project, getSnapshot: () => ({}), getTelemetrySnapshot: () => ({}), selectClips() {},
		actions: { projectBin: {}, edit: { commit(value) { command = value; } } } });
	const map = Array.prototype.map;
	let visits = 0;
	Array.prototype.map = function<T, R>(this: T[], callback: (value: T, index: number, array: T[]) => R, receiver?: unknown): R[] {
		if (this !== project.tracks || !new Error().stack?.includes('editor-project-bin-visual-actions')) return map.call(this, callback, receiver) as R[];
		return map.call(this, (value: T, index: number, array: T[]) => { visits++; return callback.call(receiver, value, index, array); }) as R[];
	};
	try {
		assert.deepEqual(actions.removeFromProject?.('bin-visual'), [...project.clips.map(clip => clip.id), 'bin-visual']);
		assert.ok(command && typeof command === 'object' && 'commands' in command && Array.isArray(command.commands));
		assert.deepEqual((command.commands as readonly unknown[]).slice(1, 1 + COUNT), project.clips.map((clip, index) => ({
			type: 'video-visual-clip/set', clipId: clip.id, expectedClip: clip,
			expectedPlacement: { scope: 'timeline', trackId: `track-${index}` }, clip: null, placement: null,
		})));
		assert.ok(visits <= COUNT * 2, `${visits} repeated source-removal track record admissions`);
	} finally { Array.prototype.map = map; }
});
