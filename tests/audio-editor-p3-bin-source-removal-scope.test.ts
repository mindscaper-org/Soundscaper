/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack, createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const [grouped, lockedPeer] of [[true, false], [false, false], [true, true]]) test(`Remove Bin source retains other media when grouped=${String(grouped)} lockedPeer=${String(lockedPeer)}`, async context => {
	const sources = ['voice', 'music'].map(id => createAudioSource({ id, name: id, sampleRate: 48_000, channelCount: 1, frameCount: 480 }));
	const clips = sources.map(source => createAudioClip({ id: source.id, title: source.name, sourceId: source.id,
		durationFrames: 480, sourceDurationFrames: 480, groupId: grouped ? 'group' : null }));
	const project = createSoundscaperProject({ id: context.name, sources, clips,
		tracks: clips.map(clip => createAudioTrack({ id: `track-${clip.id}`, clipIds: [clip.id], locked: lockedPeer && clip.id === 'music' })),
		projectBin: { clips: [createAudioClip({ ...clips[0]!, id: 'bin-voice', binItemId: 'voice-item', groupId: null })] } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	for (const source of sources) {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(480).fill(source.id === 'music' ? .5 : .25)]); await writer.commit();
	}
	const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Grouped.sscape'), () => 'copy');
	const before: unknown = controller.project; assert.ok(validateSoundscaperProject(before));
	assert.equal(controller.getSnapshot().readOnly, false);
	assert.equal(controller.actions.projectBin.instanceCount('bin-voice'), 1);
	if (lockedPeer) {
		assert.throws(() => controller.actions.projectBin.removeFromProject('bin-voice'), /locked/iu);
		assert.deepEqual(controller.project, before);
		return;
	}
	controller.actions.projectBin.removeFromProject('bin-voice');
	const after: unknown = controller.project; assert.ok(validateSoundscaperProject(after));
	assert.deepEqual(after.clips.map(clip => clip.id), ['music']);
	assert.deepEqual(after.clips[0], before.clips.find(clip => clip.id === 'music'));
	assert.deepEqual(after.sources.map(source => source.id), [after.clips[0]!.sourceId]);
	await controller.actions.project.flush(); const saved: unknown = await store.loadProject(after.id);
	assert.ok(validateSoundscaperProject(saved)); assert.deepEqual(saved.clips, after.clips);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before.clips);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, after.clips);
});

test('Bin source removal keeps paired picture and sound together without removing another grouped recording', () => {
	const audio = createAudioSource({ id: 'audio', sampleRate: 48_000, channelCount: 1, frameCount: 48_000 });
	const music = createAudioSource({ ...audio, id: 'music-source', storageKey: 'music' });
	const picture = createVideoSource({ id: 'picture', storageKey: 'picture', mimeType: 'video/mp4', contentSha256: '12'.repeat(32),
		sampleFrameCount: 48_000, sourceFrameCount: 25, frameRate: { num: 25, den: 1 }, width: 320, height: 180 });
	const video = { kind: 'video', id: 'video', sourceId: picture.id, sequenceId: 'main', sequenceStartFrame: 0,
		sequenceFrameCount: 25, sourceInFrame: 0, sourceFrameCount: 25, avLinkId: 'pair', groupId: 'group' };
	const sound = createAudioClip({ id: 'sound', sourceId: audio.id, avLinkId: 'pair', groupId: 'group',
		durationFrames: 48_000, sourceDurationFrames: 48_000 });
	const companion = createAudioClip({ id: 'music-clip', sourceId: music.id, groupId: 'group',
		durationFrames: 48_000, sourceDurationFrames: 48_000 });
	const project = createFramescaperProject(PROFILE, { id: 'paired-bin-removal', sources: [picture, audio, music], clips: [video, sound, companion],
		tracks: [createVideoTrack({ id: 'picture-track', clipIds: [video.id], laneGroupId: 'lane' }),
			createAudioTrack({ id: 'sound-track', clipIds: [sound.id], laneGroupId: 'lane' }), createAudioTrack({ id: 'music-track', clipIds: [companion.id] })],
		projectBin: { clips: [createAudioClip({ ...sound, id: 'bin-sound', avLinkId: null, groupId: null, binItemId: 'sound-item' })] },
		sequences: [{ id: 'main', rate: { num: 25, den: 1 }, trackIds: ['picture-track', 'sound-track', 'music-track'] }], primarySequenceId: 'main' });
	const after = applyFramescaperProjectCommand(PROFILE, project, { type: 'project-bin/remove-from-project', clipId: 'bin-sound' });
	assert.deepEqual(after.clips.map(clip => clip.id), ['music-clip']);
	assert.deepEqual(after.clips[0], project.clips.find(clip => clip.id === 'music-clip'));
});
