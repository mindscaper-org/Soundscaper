/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

test('source audition prepares only the healthy clip even when another pitched recording is unavailable', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'source-audition-inventory' });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const previews: ReturnType<typeof createMemoryEngine>[] = [];
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: { ...createMemoryEngine(), subscribeState: () => () => undefined, getPlaybackGain: () => 1 } as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		engineFactory: () => { const engine = { ...createMemoryEngine(), setPlaybackGain() {}, setPlayRange() {}, subscribePosition: () => () => undefined }; previews.push(engine); return engine; },
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const writer = await store.beginSourceWrite('healthy-pcm', { sampleRate: 8_000, channelCount: 1 });
	await writer.write([new Float32Array(8_000).fill(0.25)]); await writer.commit();
	const sources = ['healthy', 'unavailable'].map(id => createAudioSource({ id, storageKey: `${id}-pcm`, sampleRate: 8_000, channelCount: 1, frameCount: 8_000 }));
	const clips = sources.map(source => createAudioClip({ id: `${source.id}-clip`, sourceId: source.id, durationFrames: 8_000,
		sourceDurationFrames: 8_000, pitchCents: source.id === 'unavailable' ? 100 : 0 }));
	const project = createSoundscaperProject({ id: 'source-audition', sampleRate: 8_000, sources, clips,
		tracks: clips.map(clip => createAudioTrack({ id: `${clip.id}-track`, clipIds: [clip.id] }, 8_000)) });
	await store.saveProject(project, {}); await controller.actions.project.open(project);
	await controller.actions.clipSourcePreview.playPause('healthy-clip');
	assert.equal(controller.actions.clipSourcePreview.snapshot().state, 'playing');
	assert.equal(previews.length, 1);
	await assert.rejects(controller.actions.clipSourcePreview.playPause('unavailable-clip'), /requested audio source could not be found/u);
});
