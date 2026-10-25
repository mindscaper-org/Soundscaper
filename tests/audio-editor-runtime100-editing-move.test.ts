/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareClipPointerDuplicateCommand } from '../src/common/editor/controller/clip-video/internal/clip/clip-pointer-duplicate-command.ts';
import { createClipTransformService } from '../src/common/editor/controller/clip-video/internal/clip/clip-transform-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import { commandFixture } from './helpers/round3-command-fixtures.ts';
import { visits } from './helpers/runtime50-editing-metrics.ts';

function harness() {
	const project = commandFixture(120, 120);
	for (const clip of project.clips) Object.freeze(clip);
	Object.freeze(project.clips);
	for (const track of project.tracks) { Object.freeze(track.clipIds); Object.freeze(track); }
	Object.freeze(project.tracks);
	let commands = 0, next = 0;
	const service = createClipTransformService({ lifetime: { assertActive: () => undefined }, copy: { audioClipNotFound: 'Missing clip', track: 'Track', timelineFramesFinite: 'Finite frames required' }, getProject: () => project as unknown as ClipTransformProject, getSelectedClipId: () => 'clip-0', editingBlocked: () => false, createId: prefix => `${prefix}-${next++}`, snapTimelineFrame: frame => Number(frame), activeSelection: () => null, commit: () => { commands++; } });
	return { service, project, commands: () => commands };
}

test('E18 moving a clip selection indexes source ownership and track offsets once', context => {
	const { service, project, commands } = harness();
	const count = visits('find', () => service.moveClips('clip-0', 'track-0', 1, { clipIds: project.clips.map(clip => clip.id) }));
	assert.equal(commands(), 1);
	context.diagnostic(`E18 move find visits: ${count}`);
	assert.ok(count < 8000);
});

test('E19 moving a clip selection to fresh tracks indexes its original track span', context => {
	const { service, project, commands } = harness();
	const count = visits('find', () => service.moveClipsToNewTrack('clip-0', 1, { clipIds: project.clips.map(clip => clip.id) }));
	assert.equal(commands(), 1);
	context.diagnostic(`E19 new track move find visits: ${count}`);
	assert.ok(count < 8000);
});

test('E20 pointer duplicate carrier indexes original clip owners after descriptor preparation', context => {
	const { project } = harness();
	let next = 0;
	const transforms = project.clips.map((clip, index) => ({ clipId: clip.id, trackId: project.tracks[index]!.id, changes: { timelineStartFrame: clip.timelineStartFrame + 1 } }));
	const count = visits('find', () => {
		const result = prepareClipPointerDuplicateCommand({ createId: prefix => `${prefix}-${next++}`, createDuplicateClipboard: () => ({ schemaVersion: 1, sampleRate: 48000, durationFrames: 1, tracks: [], sources: [] }) }, project as unknown as ClipTransformProject, project.clips[0]!, project.clips, transforms);
		assert.equal(result.command.type, 'batch');
	});
	context.diagnostic(`E20 duplicate owner find visits: ${count}`);
	assert.ok(count < 1000);
});
