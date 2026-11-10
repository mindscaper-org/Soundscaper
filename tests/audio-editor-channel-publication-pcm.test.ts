/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createProjectStore, type AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { createSoundscaperProject, type SoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryProjectStore } from './helpers/memory-project-store.ts';
import { readPcm } from './helpers/project-store-pcm-fixture.ts';

type Operation = 'split' | 'track-resample' | 'clip-resample';

for (const operation of ['split', 'track-resample', 'clip-resample'] as const) {
	for (const microfades of [false, true]) test(`${operation} publishes authored PCM without new fades when preference=${microfades}`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 4_800, channelCount: operation === 'split' ? 2 : 1 });
		const project = createSoundscaperProject({ id: `channel-publication-${operation}-${microfades}`, sources: [source],
			clips: [createAudioClip({ id: 'left-clip', sourceId: source.id, durationFrames: 4_800,
				sourceDurationFrames: 4_800, fadeInFrames: 0, fadeOutFrames: 0 })],
			tracks: [createAudioTrack({ id: 'left', name: 'Left', clipIds: ['left-clip'] })] });
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const writer = await store.beginSourceWrite(source.storageKey, source);
		const originalPcm = Array.from({ length: source.channelCount }, (_, channel) => new Float32Array(4_800).fill(channel ? -.125 : .25));
		await writer.write(originalPcm); await writer.commit();
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
			projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
			engine: createMemoryEngine() as unknown as Options['engine'],
			ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
			engineFactory: () => { throw new Error('Channel publication must use the real PCM transform, not a render substitute.'); } });
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		await controller.actions.preferences.update({ editing: { applyMicrofadesToNewClips: microfades } });
		const preferences = controller.getSnapshot().preferences;
		assert.ok(typeof preferences === 'object' && preferences !== null && 'editing' in preferences);
		const editing = preferences.editing;
		assert.ok(typeof editing === 'object' && editing !== null && 'applyMicrofadesToNewClips' in editing);
		assert.equal(editing.applyMicrofadesToNewClips, microfades);
		await controller.actions.project.open(project);
		const before = structuredClone(controller.project);
		assert.ok(validateSoundscaperProject(before));

		if (operation === 'split') await controller.actions.track.splitStereoLR('left');
		else if (operation === 'track-resample') await controller.actions.track.resample('left', 24_000);
		else await controller.actions.clip.resample('left-clip', { sampleRate: 24_000 });
		const after = structuredClone(controller.project);
		assert.ok(validateSoundscaperProject(after));
		await assertPublishedPcm(after, store, operation);

		controller.actions.edit.undo();
		assert.deepEqual(controller.project?.clips, before.clips);
		assert.deepEqual(controller.project?.tracks, before.tracks);
		assert.deepEqual(await readPcm(store, source.storageKey), originalPcm.map(channel => Array.from(channel)));
		controller.actions.edit.redo();
		assert.deepEqual(controller.project?.clips, after.clips);
		await assertPublishedPcm(after, store, operation);

		const archives = createSoundscaperScapeNativeRuntime();
		const exported = await archives.exportScapeProject(controller.project, store);
		assert.ok(exported.blob);
		const recipient = createMemoryProjectStore(context, `${context.name}-reopened`);
		const reopened = await archives.importScapeProject(exported.blob, recipient);
		assert.equal(reopened.readOnly, false);
		assert.ok(validateSoundscaperProject(reopened.project));
		await assertPublishedPcm(reopened.project, recipient, operation);
	});
}

async function assertPublishedPcm(project: SoundscaperProject, store: AudioEditorProjectStore, operation: Operation): Promise<void> {
	const split = operation === 'split';
	assert.equal(project.sampleRate, 48_000, 'the project clock remains independent from resampled source clocks');
	assert.equal(project.clips.length, split ? 2 : 1);
	assert.equal(project.tracks.length, split ? 2 : 1);
	if (split) assert.deepEqual(project.tracks.map(track => track.pan), [-1, 1]);
	for (const [index, track] of project.tracks.entries()) {
		const clipIds = track.clipIds;
		assert.ok(Array.isArray(clipIds));
		assert.equal(clipIds.length, 1);
		const clipId: unknown = clipIds[0];
		assert.equal(typeof clipId, 'string');
		const clip = project.clips.find(value => value.id === clipId);
		assert.ok(clip?.kind === 'audio');
		assert.equal(clip.timelineStartFrame, 0);
		assert.equal(clip.durationFrames, 4_800);
		assert.equal(clip.sourceStartFrame, 0);
		assert.equal(clip.sourceDurationFrames, split ? 4_800 : 2_400);
		assert.deepEqual([clip.fadeInFrames, clip.fadeOutFrames], [0, 0]);
		const source = project.sources.find(value => value.id === clip.sourceId);
		assert.ok(source?.kind === 'audio');
		assert.equal(source.sampleRate, split ? 48_000 : 24_000);
		assert.equal(source.frameCount, split ? 4_800 : 2_400);
		assert.equal(source.channelCount, 1);
		const channels = await readPcm(store, source.storageKey);
		assert.equal(channels.length, 1);
		assert.equal(channels[0]!.length, split ? 4_800 : 2_400);
		const expected = split && index === 1 ? -.125 : .25;
		for (const [frame, sample] of channels[0]!.entries()) {
			assert.ok(Math.abs(sample - expected) < 1e-7, `channel ${index} frame ${frame}: ${sample} must preserve ${expected}`);
		}
	}
}
