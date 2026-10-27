import assert from 'node:assert/strict';
import test from 'node:test';

import { createMixRenderPlan, selectAudioTracksForMix } from '../src/common/editor/controller/track-audio/mix-render-model.ts';
import type { ControllerClip, ControllerProject, ControllerTrack } from '../src/common/editor/controller/track-audio/track-domain-types.ts';

function fixture(tracks: ControllerTrack[], clips: ControllerClip[], selected: string[]): ControllerProject {
	return { schemaVersion: 1, id: 'mix', title: 'Mix', sampleRate: 48_000,
		tracks, clips, sources: [], mixer: { groups: [], sends: [], routes: {} },
		selection: { startFrame: 0, endFrame: 0, trackIds: selected } };
}

test('mix selection and clip bounds inspect each inventory once while preserving authored order', () => {
	const count = 1_000;
	let trackReads = 0, clipReads = 0;
	const tracks: ControllerTrack[] = Array.from({ length: count }, (_, index) => ({
		get id() { trackReads++; return `track-${index}`; },
		name: `Track ${index}`, type: 'audio', clipIds: [`clip-${index}`],
	}));
	const clips: ControllerClip[] = Array.from({ length: count }, (_, index) => ({
		get id() { clipReads++; return `clip-${index}`; },
		sourceId: 'source', timelineStartFrame: index * 10, sourceStartFrame: 0,
		sourceDurationFrames: 10, durationFrames: 10,
	}));
	const project = fixture(tracks, clips, Array.from({ length: count }, (_, index) => `track-${count - index - 1}`));
	const selected = selectAudioTracksForMix(project, null, null);
	assert.deepEqual(selected, tracks);
	assert.ok(trackReads <= count * 4, `${trackReads} track ID reads for ${count} tracks`);
	const plan = createMixRenderPlan(project, selected, 5, 1, 1);
	assert.deepEqual(plan, { startFrame: 0, endFrame: 10_000, tailFrames: 5, preRollFrames: 0,
		outputFrames: 10_005, outputChannelCount: 1, outputBytes: 40_020, streamToStorage: true });
	assert.ok(clipReads <= count * 2, `${clipReads} clip ID reads for ${count} clips`);
});

test('mix lookup projections are local to each invocation and retain fallback selection', () => {
	const tracks: ControllerTrack[] = [
		{ id: 'label', name: 'Labels', type: 'label' },
		{ id: 'audio', name: 'Audio', type: 'audio', clipIds: ['clip'] },
	];
	const clips: ControllerClip[] = [{ id: 'clip', sourceId: 'source', timelineStartFrame: 8,
		sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4 }];
	const project = fixture(tracks, clips, ['label', 'missing']);
	assert.deepEqual(selectAudioTracksForMix(project, null, 'clip'), [tracks[1]]);
	assert.deepEqual(selectAudioTracksForMix(project, 'audio', null), [tracks[1]]);
	assert.equal(createMixRenderPlan(project, [tracks[1]!], 0, 1_000)?.endFrame, 12);
	clips[0] = { ...clips[0]!, timelineStartFrame: 20 };
	tracks[1] = { ...tracks[1]!, id: 'replacement' };
	assert.deepEqual(selectAudioTracksForMix(project, 'audio', null), []);
	assert.deepEqual(selectAudioTracksForMix(project, null, 'clip'), [tracks[1]]);
	assert.equal(createMixRenderPlan(project, [tracks[1]!], 0, 1_000)?.endFrame, 24);
	assert.equal(createMixRenderPlan(project, [], 0, 1_000), null);
});
