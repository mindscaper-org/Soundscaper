/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { projectForCommand } from '../src/common/editor/command-project-view.ts';
import { isRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';

test('command projection visits each Project Bin clip once and retains indexed musical coordinates', () => {
	const clips = Array.from({ length: 1_000 }, (_, index) => ({
		id: `bin-${String(index)}`, kind: 'audio', sourceId: 'source', anchor: 'musical',
		musicalStartBeat: { num: index, den: 1 }, musicalExtent: 'beat', musicalDurationBeats: { num: 1, den: 1 },
		sourceStartFrame: 0, sourceDurationFrames: 48_000,
	}));
	let clipReads = 0;
	const trackedClips = new Proxy(clips, {
		get(target, key, receiver) {
			if (typeof key === 'string' && /^\d+$/u.test(key)) clipReads += 1;
			return Reflect.get(target, key, receiver) as unknown;
		},
	});
	const project = { schemaVersion: 9, sampleRate: 48_000, clips: [], tracks: [], sources: [],
		tempoMap: { mode: 'musical' as const,
			events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
				{ beat: { num: 500, den: 1 }, bpm: { num: 60, den: 1 } }] },
		projectBin: { clips: trackedClips, name: 'Preserved bin metadata' } };
	const projected = projectForCommand(project);
	assert.equal(clipReads, 1_000);
	assert.equal(isRuntimeProjectProjection(projected), true);
	assert.equal(projected.projectBin.name, 'Preserved bin metadata');
	assert.equal(projected.projectBin.clips[0]!.timelineStartFrame, 0);
	assert.equal(projected.projectBin.clips[500]!.timelineStartFrame, 12_000_000);
	assert.equal(projected.projectBin.clips[999]!.timelineStartFrame, 35_952_000);
	assert.equal(Object.hasOwn(clips[0]!, 'timelineStartFrame'), false);
});

test('command projection keeps video source aliases without changing the inventory', () => {
	const project = { schemaVersion: 9, sampleRate: 48_000, clips: [], tracks: [], projectBin: { clips: [] },
		sources: [{ id: 'video', kind: 'video' as const, sampleFrameCount: 48_000 }] };
	const projected = projectForCommand(project);
	assert.equal(projected.sources[0]!.frameCount, 48_000);
	assert.equal(Object.hasOwn(project.sources[0]!, 'frameCount'), false);
});
