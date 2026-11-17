/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioSource, createAudioTrack, createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';

function fixture() {
	return createSoundscaperProject({ id: 'av-playlist', sources: [
		createVideoSource({ id: 'picture', name: 'Camera', sampleFrameCount: 48000, sourceFrameCount: 30, frameRate: { num: 30, den: 1 }, width: 320, height: 180 }),
		createAudioSource({ id: 'sound', sampleRate: 48000, frameCount: 48000, channelCount: 1 }),
	], primarySequenceId: 'main', sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['v', 'a'] }],
	tracks: [createVideoTrack({ id: 'v', laneGroupId: 'camera', clipIds: ['vc'] }), createAudioTrack({ id: 'a', laneGroupId: 'camera', clipIds: ['ac'] })],
	clips: [{ id: 'vc', kind: 'video', sourceId: 'picture', sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30, avLinkId: 'link' },
		{ id: 'ac', kind: 'audio', sourceId: 'sound', timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48000, durationFrames: 48000, avLinkId: 'link' }] });
}
const create = { type: 'track/playlist-create', trackId: 'a', id: 'edit', name: 'Audio edit', originalId: 'original', originalName: 'Original', mode: 'empty' } as const;

test('an empty audio playlist leaves the camera picture in place and remains recallable', () => {
	const original = fixture();
	const empty = applySoundscaperProjectCommand(original, create);
	assert.equal(empty.clips.length, 1);
	assert.equal(empty.clips[0]!.id, 'vc');
	assert.equal(empty.clips[0]!.avLinkId, null);
	const restored = applySoundscaperProjectCommand(empty, { type: 'track/playlist-activate', trackId: 'a', id: 'original' });
	assert.equal(validateSoundscaperProject(restored), true);
	assert.equal(restored.clips.find(clip => clip.id === 'ac')!.durationFrames, 48000);
	assert.equal(restored.clips.find(clip => clip.id === 'vc')!.sequenceStartFrame, 0);
});

test('recalling an audio arrangement after a linked move does not move or break the picture', () => {
	let project = applySoundscaperProjectCommand(fixture(), { ...create, mode: 'duplicate' });
	project = applySoundscaperProjectCommand(project, { type: 'clip/transform-many', transforms: [
		{ clipId: 'ac', changes: { timelineStartFrame: 48000 } },
		{ clipId: 'vc', changes: { timelineStartFrame: 48000 }, sequencePlacement: { sequenceStartFrame: 30, sequenceFrameCount: 30 } },
	] });
	const picture = project.clips.find(clip => clip.id === 'vc')!;
	assert.equal(picture.sequenceStartFrame, 30);
	project = applySoundscaperProjectCommand(project, { type: 'track/playlist-activate', trackId: 'a', id: 'original' });
	assert.equal(project.clips.find(clip => clip.id === 'ac')!.timelineStartFrame, 0);
	assert.equal(project.clips.find(clip => clip.id === 'vc')!.sequenceStartFrame, 30);
	assert.equal(validateSoundscaperProject(project), true);
});

test('unchanged duplicate arrangements retain their camera link and respect a locked picture', () => {
	const original = applySoundscaperProjectCommand(fixture(), { type: 'track/update', trackId: 'v', changes: { locked: true } });
	const duplicate = applySoundscaperProjectCommand(original, { ...create, mode: 'duplicate' });
	const recalled = applySoundscaperProjectCommand(duplicate, { type: 'track/playlist-activate', trackId: 'a', id: 'original' });
	assert.ok(recalled.clips.every(clip => clip.avLinkId === 'link'));
	assert.throws(() => applySoundscaperProjectCommand(original, create), /locked|Unlock/iu);
	assert.equal(original.clips.length, 2);
});
