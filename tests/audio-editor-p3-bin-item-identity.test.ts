/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack, createVideoSource, createVideoClip, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const collision of [false, true]) for (const grouped of [false, true]) {
	test(`Move to Bin retains separate item identities (${collision ? 'occupied' : 'free'}, ${grouped ? 'group' : 'single'})`, async context => {
		const source = createAudioSource({ id: 'sound', name: 'Sound', sampleRate: 48_000, channelCount: 1, frameCount: 480 });
		const clips = ['take', ...(grouped ? ['peer'] : [])].map(id => createAudioClip({ id, title: id, sourceId: source.id,
			durationFrames: 480, sourceDurationFrames: 480, groupId: grouped ? 'group' : null }));
		const bin = createAudioClip({ id: 'existing', title: 'Existing Bin recording', sourceId: source.id,
			durationFrames: 480, sourceDurationFrames: 480, binItemId: collision ? 'take' : 'old-item' });
		const project = createSoundscaperProject({ id: context.name, sources: [source], clips,
			tracks: clips.map(clip => createAudioTrack({ id: `track-${clip.id}`, clipIds: [clip.id] })), projectBin: { clips: [bin, ...(collision ? [{ ...bin, id: 'existing-suffix', binItemId: 'take:bin:1' }] : [])] } });
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(480).fill(.25)]); await writer.commit();
		const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
			engine: createMemoryEngine() as unknown as Options['engine'] });
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		await controller.actions.project.openScapeFile(new File([archive.blob], 'Bin.sscape'), () => 'copy');
		assert.equal(controller.getSnapshot().readOnly, false);
		const before: unknown = controller.project; assert.ok(validateSoundscaperProject(before));
		controller.actions.projectBin.moveFromTimeline('take');
		const after: unknown = controller.project; assert.ok(validateSoundscaperProject(after));
		assert.equal(after.clips.length, 0);
		assert.equal(after.projectBin.clips.length, clips.length + before.projectBin.clips.length);
		assert.equal(new Set(after.projectBin.clips.map(clip => clip.binItemId)).size, clips.length + before.projectBin.clips.length);
		for (const original of before.projectBin.clips) {
			assert.deepEqual(after.projectBin.clips.find(clip => clip.id === original.id), original);
		}
		await controller.actions.project.flush();
		const saved: unknown = await store.loadProject(after.id); assert.ok(validateSoundscaperProject(saved));
		assert.deepEqual(saved.projectBin.clips, after.projectBin.clips);
		controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before.clips);
		assert.deepEqual(controller.project?.projectBin.clips, before.projectBin.clips);
		controller.actions.edit.redo(); assert.deepEqual(controller.project?.projectBin.clips, after.projectBin.clips);
	});
}

for (const paired of [false, true]) test(`native camera Bin items stay separate from ${paired ? 'a moved A/V pair' : 'unrelated moved sound'}`, () => {
	const sequence = { id: 'main', rate: { num: 25, den: 1 } };
	const sound = createAudioSource({ id: 'sound', sampleRate: 48_000, channelCount: 1, frameCount: 48_000 });
	const camera = createVideoSource({ id: 'camera', mimeType: 'video/mp4', storageKey: 'camera', contentSha256: '12'.repeat(32),
		sampleFrameCount: 48_000, sourceFrameCount: 25, frameRate: sequence.rate, width: 320, height: 180 });
	const picture = createVideoClip({ id: 'picture', sourceId: camera.id, sequenceId: sequence.id, sequenceStartFrame: 0,
		sequenceFrameCount: 25, sourceInFrame: 0, sourceFrameCount: 25, avLinkId: paired ? 'pair' : null }, { projectSampleRate: 48_000, sequence, source: camera });
	const audio = createAudioClip({ id: 'audio', sourceId: sound.id, durationFrames: 48_000, sourceDurationFrames: 48_000,
		avLinkId: paired ? 'pair' : null });
	const project = createFramescaperProject(PROFILE, { id: `bin-linked-${String(paired)}`, sources: [sound, camera],
		clips: paired ? [picture, audio] : [audio],
		tracks: paired ? [createVideoTrack({ id: 'pictures', clipIds: [picture.id], laneGroupId: 'lanes' }),
			createAudioTrack({ id: 'sound-track', clipIds: [audio.id], laneGroupId: 'lanes' })] : [createAudioTrack({ id: 'sound-track', clipIds: [audio.id] })],
		projectBin: { clips: paired ? [createAudioClip({ ...audio, id: 'existing', avLinkId: null, binItemId: picture.id })]
			: [{ ...picture, id: 'existing', binItemId: audio.id }] },
		sequences: [{ ...sequence, trackIds: paired ? ['pictures', 'sound-track'] : ['sound-track'] }], primarySequenceId: sequence.id,
	});
	const after = applyFramescaperProjectCommand(PROFILE, project, { type: 'project-bin/move-from-timeline', clipIds: [audio.id] });
	assert.equal(after.clips.length, 0);
	assert.equal(new Set(after.projectBin.clips.map(clip => clip.binItemId)).size, 2);
	assert.deepEqual(after.projectBin.clips.find(clip => clip.id === 'existing'), project.projectBin.clips[0]);
	if (paired) assert.equal(after.projectBin.clips.find(clip => clip.id === picture.id)?.binItemId,
		after.projectBin.clips.find(clip => clip.id === audio.id)?.binItemId);
});
