/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { FramescaperImageClipV1 } from '../src/common/editor/timeline-image-model.ts';
import { videoFrameToSampleFrame } from '../src/common/editor/timeline-time.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';

const PICTURE = 'video-track';

test('ripple-deleting video also closes the gap before a following image', () => {
	const fixture = createFramescaperBaselineImageFixture();
	const video = fixture.project.clips.find(clip => clip.id === 'video-clip');
	assert.ok(video && typeof video.sequenceFrameCount === 'number');
	const sequence = fixture.project.sequences[0]!;
	const project = applyFramescaperProjectCommand(PROFILE, fixture.project, {
		type: 'clip/move', clipId: fixture.clip.id,
		timelineStartFrame: videoFrameToSampleFrame(video.sequenceFrameCount, sequence.rate, fixture.project.sampleRate),
	});
	const after = applyFramescaperProjectCommand(PROFILE, project, {
		type: 'clip/remove-many', clipIds: [video.id], rippleMode: 'track',
	});
	assert.deepEqual(after.clips.find(clip => clip.id === fixture.clip.id), fixture.clip);
});

test('mixed track ripple removes the union of overlapping image and video ranges from a following image', () => {
	const fixture = createFramescaperBaselineImageFixture();
	const video = fixture.project.clips.find(clip => clip.id === 'video-clip');
	assert.ok(video && typeof video.sequenceFrameCount === 'number');
	const following: FramescaperImageClipV1 = { ...fixture.clip, id: 'following-image', sequenceStartFrame: 500 };
	const project = applyFramescaperProjectCommand(PROFILE, fixture.project, {
		type: 'image-clip/set', clipId: following.id, expectedClip: null, expectedPlacement: null,
		clip: following, placement: { scope: 'timeline', trackId: PICTURE },
	});
	const after = applyFramescaperProjectCommand(PROFILE, project, {
		type: 'clip/remove-many', clipIds: [fixture.clip.id, video.id], rippleMode: 'track',
	});
	assert.deepEqual(after.clips.find(clip => clip.id === following.id), {
		...following, sequenceStartFrame: following.sequenceStartFrame - Math.max(fixture.clip.sequenceFrameCount, video.sequenceFrameCount),
	});
});
