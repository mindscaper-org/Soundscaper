/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSourceEditorEffects } from '../src/common/editor/controller/effects/internal/source-editor-effects.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';

for (const trackId of ['voice', 'source-editor:original', 'source-editor:missing']) test(`native timeline track ${trackId} never impersonates a source selection`, async () => {
	const source = createAudioSource({ id: 'original', sampleRate: 48_000, channelCount: 1, frameCount: 8 });
	const project = createSoundscaperProject({ sampleRate: 48_000, sources: [source],
		tracks: [createAudioTrack({ id: trackId, clipIds: ['clip'] })],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, sourceStartFrame: 4, sourceDurationFrames: 4, durationFrames: 4 })] });
	const pcm = Float32Array.of(.1, .1, .1, .1, .4, .4, .4, .4);
	let loads = 0;
	const runtimeProject = { ...project, clips: project.clips.map(clip => ({ ...clip, kind: 'audio' as const,
		timelineStartFrame: 0, sourceStartFrame: 4, sourceDurationFrames: 4, durationFrames: 4 })) };
	const service = createSourceEditorEffects({ getProject: () => runtimeProject, publishDocumentSnapshot() {},
		loadSourceBuffer: async () => { loads++; return { length: 8, numberOfChannels: 1, sampleRate: 48_000, getChannelData: () => pcm }; } });
	assert.equal(await service.renderRange(trackId, 0, 4), null, 'ordinary timeline capture must retain clip trim/placement');
	assert.equal(loads, 0);
	service.setSourceSelection({ clipId: 'clip', startFrame: 1, endFrame: 3 });
	const selected = service.target(); assert.ok(selected);
	assert.notEqual(selected.track.id, trackId, 'private source target must not alias an admitted timeline track');
	assert.deepEqual(await service.renderRange(selected.track.id, 1, 3), [pcm.slice(1, 3)]);
	assert.equal(await service.renderRange(trackId, 0, 4), null);
});
