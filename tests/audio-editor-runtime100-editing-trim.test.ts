/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { collectClipTrimIds } from '../src/common/editor/commands/clip-basic-runtime.js';
import { commandFixture } from './helpers/round3-command-fixtures.ts';
import { visits } from './helpers/runtime50-editing-metrics.ts';

function freezeParticipants(project: ReturnType<typeof commandFixture>) {
	for (const clip of project.clips) Object.freeze(clip);
	Object.freeze(project.clips);
	for (const track of project.tracks) { Object.freeze(track.clipIds); Object.freeze(track); }
	Object.freeze(project.tracks);
	return project;
}

test('E26 grouped edge trim resolves clip and first-owner participants once', context => {
	const project = commandFixture(200, 200);
	for (const clip of project.clips) clip.groupId = 'group';
	freezeParticipants(project);
	let result: readonly string[] = [];
	const count = visits('find', () => { result = collectClipTrimIds(project, 'clip-0', 'right'); });
	assert.deepEqual(result, project.clips.map(clip => clip.id));
	context.diagnostic(`E26 grouped trim find visits: ${count}`);
	assert.ok(count < 1000);
});

test('trim participant indexing retains mutable/getter/custom-array and duplicate authority', () => {
	for (const variant of ['ordinary', 'duplicate-clip', 'duplicate-track', 'getter', 'custom-find', 'custom-includes'] as const) {
		function run(frozen: boolean) {
			const project = commandFixture(12, 6);
			for (const clip of project.clips) clip.groupId = 'group';
			let reads = 0;
			if (variant === 'duplicate-clip') project.clips[2]!.id = project.clips[1]!.id;
			if (variant === 'duplicate-track') project.tracks[2]!.id = project.tracks[0]!.id;
			if (variant === 'getter') {
				const track = project.tracks[1]!, original = track.clipIds;
				Object.defineProperty(track, 'clipIds', { enumerable: true, get() { reads++; return original; } });
			}
			if (variant === 'custom-find') Object.defineProperty(project.clips, 'find', { value: (predicate: (value: unknown) => boolean) => Array.prototype.find.call(project.clips, predicate) as unknown });
			if (variant === 'custom-includes') Object.defineProperty(project.tracks[1]!.clipIds, 'includes', { value: () => false });
			if (frozen) freezeParticipants(project);
			reads = 0;
			return { result: collectClipTrimIds(project, 'clip-0', 'left'), reads };
		}
		assert.deepEqual(run(true), run(false), variant);
	}
});
