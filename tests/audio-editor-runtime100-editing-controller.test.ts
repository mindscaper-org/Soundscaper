/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { clipMoveSelection } from '../src/common/editor/controller/clip-video/internal/clip/clip-move-options.ts';
import { prepareMediaNewTrackPlan } from '../src/common/editor/controller/clip-video/internal/clip/media-new-track-plan.ts';
import { prepareGroupedLoopTrimCommand } from '../src/common/editor/controller/clip-video/internal/clip/grouped-loop-trim-command.ts';
import { prepareDuplicateSelectionCommand } from '../src/common/editor/controller/edit/internal/duplicate-selection-command.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import { commandFixture } from './helpers/round3-command-fixtures.ts';
import { visits } from './helpers/runtime50-editing-metrics.ts';

function fixture(count = 200): ClipTransformProject {
	const project = commandFixture(count, count);
	for (const clip of project.clips) Object.freeze(clip);
	Object.freeze(project.clips);
	for (const track of project.tracks) { Object.freeze(track.clipIds); Object.freeze(track); }
	Object.freeze(project.tracks);
	return project as unknown as ClipTransformProject;
}
function ids() { let next = 0; return (prefix?: string) => `${prefix}-generated-${next++}`; }

test('E12 move-selection track projection indexes clip membership', context => {
	const project = fixture(), selected = Object.freeze(project.clips.map(clip => clip.id));
	let result: ReturnType<typeof clipMoveSelection>;
	const count = visits('includes', () => { result = clipMoveSelection(project, selected, { allOnTrack: true }); });
	assert.deepEqual(result!.trackIds, project.tracks.map(track => track.id));
	context.diagnostic(`E12 selected clip membership slots: ${count}`);
	assert.equal(count, 0);
});

test('E13 new media track planning indexes selected clip identities', context => {
	const project = fixture();
	let probes = 0;
	const original = Array.prototype.some;
	Array.prototype.some = function (predicate, thisArg) { return Reflect.apply(original, this, [(value: unknown, index: number, values: unknown[]) => { probes++; return Reflect.apply(predicate, thisArg, [value, index, values]) as unknown; }]) as boolean; };
	try { const plan = prepareMediaNewTrackPlan(project, project.clips, ids(), 'Audio'); assert.equal(plan.commands.length, 200); }
	finally { Array.prototype.some = original; }
	context.diagnostic(`E13 selection predicate visits: ${probes}`);
	assert.ok(probes < 2000);
});

test('E14 grouped loop trim prepares source bounds from one immutable source index', context => {
	const project = fixture();
	const sources = Object.freeze(project.clips.map((clip, index) => Object.freeze({ id: `source-${index}`, frameCount: 100000, sampleRate: 48000 })));
	const clips = project.clips.map((clip, index) => ({ ...clip, sourceId: sources[index]!.id }));
	let command: ReturnType<typeof prepareGroupedLoopTrimCommand>;
	const count = visits('find', () => { command = prepareGroupedLoopTrimCommand({ ...project, sources }, clips, 'right', 1); });
	assert.equal(command!.type, 'batch');
	context.diagnostic(`E14 source find visits: ${count}`);
	assert.ok(count < 1000);
});

test('E14 grouped trim preserves per-candidate source identity getter reads', () => {
	for (const dynamic of [false]) {
		const run = (frozen: boolean) => {
			const original = fixture(1);
			const sources = ['first', 'second'].map(id => Object.freeze({ id, frameCount: 100000, sampleRate: 48000 }));
			if (frozen) Object.freeze(sources);
			let sourceReads = 0;
			const clip = { ...original.clips[0]!, get sourceId() { sourceReads++; return dynamic && sourceReads === 1 ? 'missing' : 'second'; } };
			let command: unknown, error: unknown;
			try { command = prepareGroupedLoopTrimCommand({ ...original, sources }, [clip], 'right', 1); }
			catch (failure) { assert.ok(failure instanceof Error); error = { name: failure.name, message: failure.message }; }
			return { command, error, sourceReads };
		};
		const legacy = run(false);
		assert.equal(legacy.error, undefined);
		assert.ok(legacy.command);
		assert.deepEqual(run(true), legacy);
	}
});

test('E15 track duplication prepares lane-group completeness once', context => {
	const original = commandFixture(200, 200);
	for (let index = 0; index < original.tracks.length; index++) { const track = original.tracks[index]!; track.laneGroupId = `lanes-${Math.floor(index / 2)}`; Object.freeze(track); }
	Object.freeze(original.tracks);
	const project = original as unknown as ReturnType<Parameters<typeof prepareDuplicateSelectionCommand>[0]['getProject']>;
	let plan: ReturnType<typeof prepareDuplicateSelectionCommand> = null;
	const count = visits('filter', () => { plan = prepareDuplicateSelectionCommand({ getProject: () => project, createStableId: ids(), createClipboardDescriptor: () => ({ schemaVersion: 1, sampleRate: 48000, durationFrames: 1, tracks: [], sources: [] }) }, { startFrame: 0, endFrame: 1, trackIds: original.tracks.map(track => track.id), exactClips: false }); });
	assert.ok(plan);
	context.diagnostic(`E15 duplicate filter visits: ${count}`);
	assert.ok(count < 3000);
});
