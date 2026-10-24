/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperAudioFreezeActions } from '../src/soundscaper/editor-audio-track-freeze-actions.ts';
import type { AudioTrackFreezeCoordinatorCommandV21 } from '../src/common/editor/audio-track-freeze-coordinator-v21.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { createSoundscaperAudioTrackFreezePlaybackService } from '../src/soundscaper/editor-audio-track-freeze-playback.ts';
import { createSoundscaperPlaybackProjectService } from '../src/soundscaper/editor-project-playback.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryRenderEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const chunkFrames of [1024, 65536]) for (const authenticated of [false, true]) test(`rendered time/pitch source remains freezable with authenticated input=${String(authenticated)} and input packet=${chunkFrames}`, async context => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const source = createAudioSource({ id: 'original', name: 'Original.wav', frameCount: 4800, sampleRate: 48_000, channelCount: 1, chunkFrames });
	const writer = await store.beginSourceWrite(source.storageKey, source);
	for (let frame = 0; frame < 4800; frame += chunkFrames) await writer.write([new Float32Array(Math.min(chunkFrames, 4800 - frame)).fill(.25)]);
	await writer.commit();
	const playback = createSoundscaperAudioTrackFreezePlaybackService(createSoundscaperPlaybackProjectService(), store);
	const digest = await playback.hashSourceContent('project', source);
	const input = authenticated ? { ...source, contentSha256: digest } : source;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		engineFactory: createMemoryRenderEngine as unknown as Options['engineFactory'] });
	context.after(async () => { playback.dispose(); await controller.dispose(); }); await controller.ready;
	await controller.actions.project.open(createSoundscaperProject({ id: 'project', sources: [input], clips: [createAudioClip({
		id: 'clip', sourceId: source.id, title: 'Voice', sourceDurationFrames: 4800, durationFrames: 2400, speedRatio: 2, linkPitchAndTempo: true,
	})], tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'], effects: [createEffect('lowpass')] })] }));
	const originalArchive = await exportScapeProject(controller.project, store); assert.ok(originalArchive.blob instanceof Blob);
	const before = controller.project;
	await controller.actions.clip.renderPitchSpeed('clip');
	const result = controller.project; assert.ok(result);
	const rendered = result.sources.find(item => item.id === result.clips[0]?.sourceId); assert.ok(rendered);
	assert.notEqual(rendered.id, source.id); assert.equal(rendered.frameCount, 2400);
	const archive = await exportScapeProject(result, store); assert.ok(archive.blob instanceof Blob, 'the delivered native project must authenticate the new PCM');
	assert.equal(before?.sources.find(item => item.id === source.id)?.contentSha256, authenticated ? digest : undefined);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before?.clips);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, result.clips);
	const freeze = createSoundscaperAudioFreezeActions({ store, playback }, {
		get project() { return controller.project; }, actions: { edit: { commit: (command: AudioTrackFreezeCoordinatorCommandV21) => controller.actions.edit.commit(command) } },
	}, { createId: kind => kind === 'source' ? 'frozen' : 'frozen-clip', createRenderEngine: () => ({
		loadProject() { /* Source digest admission and persisted freeze publication remain real. */ },
		async renderTrack(_id, options = {}) { return { channels: [new Float32Array(Number(options.outputFrames)).fill(.25), new Float32Array(Number(options.outputFrames)).fill(.25)] }; },
		async dispose() { /* no native resources */ },
	}) });
	try { await freeze.actions.freeze('voice'); assert.equal(freeze.actions.getStatus('voice'), 'fresh'); }
	finally { await freeze.dispose(); }
});
