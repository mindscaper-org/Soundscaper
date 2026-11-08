/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { stereoTrackRenderRange } from '../src/common/editor/controller/track-audio/internal/stereo-track-render-range.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createMixRenderPlan } from '../src/common/editor/controller/track-audio/mix-render-model.ts';

test('mono-to-stereo rendering uses current musical clip placement after a tempo edit', () => {
	const clip = { ...createAudioClip({ id: 'clip', sourceId: 'source', timelineStartFrame: 16000, durationFrames: 16000,
		sourceDurationFrames: 16000, anchor: 'musical', musicalStartBeat: { num: 4, den: 1 },
		musicalExtent: 'beat', musicalDurationBeats: { num: 4, den: 1 } }), timelineStartFrame: 16000, durationFrames: 16000 };
	const track = createAudioTrack({ id: 'track', clipIds: [clip.id] }, 8000);
	const project = createAudioEditorProjectV17({ sampleRate: 8000, clips: [clip], tracks: [track],
		sources: [createAudioSource({ id: 'source', sampleRate: 8000, frameCount: 16000, channelCount: 1 })],
		tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 } }] } });
	const range = stereoTrackRenderRange([track], [clip], 8000, [], project);
	assert.deepEqual(range, { startFrame: 32000, endFrame: 64000 });
});

test('Mix and Render captures the resolved musical extent rather than stale scalar duration', () => {
	const clip = { ...createAudioClip({ id: 'clip', sourceId: 'source', timelineStartFrame: 16000, durationFrames: 16000,
		sourceDurationFrames: 16000, anchor: 'musical', musicalStartBeat: { num: 4, den: 1 },
		musicalExtent: 'beat', musicalDurationBeats: { num: 4, den: 1 } }), timelineStartFrame: 16000, durationFrames: 16000 };
	const track = createAudioTrack({ id: 'track', clipIds: [clip.id] }, 8000);
	const project = createAudioEditorProjectV17({ sampleRate: 8000, clips: [clip], tracks: [track],
		sources: [createAudioSource({ id: 'source', sampleRate: 8000, frameCount: 16000, channelCount: 1 })],
		tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 } }] } });
	const controllerProject = { ...project, clips: [clip] };
	const plan = createMixRenderPlan(controllerProject, [track], 0, 1_000_000);
	assert.equal(plan?.startFrame, 32000);
	assert.equal(plan?.endFrame, 64000);
	assert.equal(plan?.outputFrames, 32000);
});
