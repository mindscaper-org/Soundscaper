/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { projectForCommand } from '../src/common/editor/command-project-view.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { prepareKeepRangeCommand, prepareRangeDeleteCommand } from '../src/common/editor/commands/range-runtime.js';

const NOW = '2026-10-26T00:00:00.000Z';
function fixture(count: number) {
	return createSoundscaperProject({ id: 'range-catalog-work', now: NOW,
		sources: [{ id: 'source', storageKey: 'source', frameCount: 64, channelCount: 1, sampleRate: 48_000 }],
		tracks: Array.from({ length: count }, (_, index) => ({ id: `track-${index}`, clipIds: [`clip-${index}`] })),
		clips: Array.from({ length: count }, (_, index) => ({ id: `clip-${index}`, sourceId: 'source', sourceStartFrame: 0,
			sourceDurationFrames: 64, durationFrames: 64, timelineStartFrame: 0 })) });
}

for (const kind of ['keep', 'none', 'clip', 'track'] as const) {
	test(`actual multi-track ${kind} range edit reassembles its owned clip catalog once`, () => {
		const count = 500, project = fixture(count), view = projectForCommand(project);
		const options = { startFrame: 0, endFrame: 32, trackIds: project.tracks.map(track => track.id) };
		const command = kind === 'keep' ? prepareKeepRangeCommand(view, options)
			: prepareRangeDeleteCommand(view, { ...options, rippleMode: kind });
		const original = Array.prototype.filter;
		let visits = 0;
		Array.prototype.filter = function<T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, receiver?: unknown): T[] {
			if (this.length !== count || !(this[0] as { id?: string })?.id?.startsWith('clip-')
				|| !/keepRange|deleteRange|processTrackRange/.test(new Error().stack ?? '')) return original.call(this, predicate, receiver);
			return original.call(this, (value: T, index: number, array: T[]) => { visits++; return predicate.call(receiver, value, index, array); });
		};
		try {
			const result = applySoundscaperProjectCommand(project, command, { now: NOW });
			const runtime = projectForRuntimeConsumers(result);
			assert.deepEqual(result.clips.map(clip => clip.id), project.clips.map(clip => clip.id));
			assert.ok(runtime.clips.every(clip => clip.durationFrames === 32));
			assert.ok(runtime.clips.every(clip => clip.timelineStartFrame === (kind === 'none' ? 32 : 0)));
			assert.ok(visits <= count * 4, `${visits} full-catalog assembly predicates`);
		} finally { Array.prototype.filter = original; }
		assert.ok(projectForRuntimeConsumers(project).clips.every(clip => clip.durationFrames === 64));
	});
}

test('range catalog staging preserves untouched order followed by each authored replacement run', () => {
	const project = fixture(4), view = projectForCommand(project);
	let serial = 0;
	const command = prepareRangeDeleteCommand(view, { startFrame: 16, endFrame: 32, trackIds: ['track-2', 'track-0'] }, () => `split-${serial++}`);
	const result = projectForRuntimeConsumers(applySoundscaperProjectCommand(project, command, { now: NOW }));
	// The producer orders affected tracks by the authored track catalog, independent of the selection order.
	assert.deepEqual(result.clips.map(clip => clip.id), ['clip-1', 'clip-3', 'clip-0', 'split-0', 'clip-2', 'split-1']);
	assert.deepEqual(result.tracks[0]!.clipIds, ['clip-0', 'split-0']);
	assert.deepEqual(result.tracks[2]!.clipIds, ['clip-2', 'split-1']);
	assert.deepEqual(result.clips.filter(clip => clip.id.startsWith('split-')).map(clip => [clip.timelineStartFrame, clip.sourceStartFrame, clip.durationFrames]), [[32, 32, 32], [32, 32, 32]]);
});
