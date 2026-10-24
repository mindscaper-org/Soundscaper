/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryRenderEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const mixDown of [true, false]) test(`Mix & Render does not add fades to already-rendered audio, mixDown=${mixDown}`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const source = createAudioSource({ id: 'recording', sampleRate: 48_000, frameCount: 4800, channelCount: 2 });
	const original = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800, fadeInFrames: 96, fadeOutFrames: 96 });
	const project = createSoundscaperProject({ id: `baked-fades-${mixDown}`, sources: [source], clips: [original],
		tracks: [createAudioTrack({ id: 'voice', clipIds: [original.id] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `baked-fades-${mixDown}` });
	const writer = await store.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(4800).fill(.25), new Float32Array(4800).fill(.25)]); await writer.commit();
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, projectRuntime: runtime,
		sessionController: runtime.createSessionController(), store, engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'], engineFactory: createMemoryRenderEngine as unknown as Options['engineFactory'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await controller.actions.project.open(project);
	controller.actions.timeline.setSelection(0, 4800, { trackIds: ['voice'] });
	const printed = await controller.actions.track.mixAndRender({ mixDown, renderEffects: true, replaceOriginals: true });
	assert.ok(printed);
	const clip = controller.project?.clips.find(value => value.id === printed.clipId);
	assert.ok(clip); assert.equal(clip.fadeInFrames, 0); assert.equal(clip.fadeOutFrames, 0);
	controller.actions.edit.undo();
	assert.equal(controller.project?.clips.find(value => value.id === original.id)?.fadeInFrames, 96);
	controller.actions.edit.redo();
	assert.equal(controller.project?.clips.find(value => value.id === printed.clipId)?.fadeInFrames, 0);
});

test('Flatten comp publishes its complete rendered programme without adding new edge fades', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const source = createAudioSource({ id: 'take', sampleRate: 48_000, frameCount: 4800, channelCount: 2 });
	const project = createSoundscaperProject({ id: 'flatten-fades', sources: [source], tracks: [createAudioTrack({ id: 'voice', clipIds: [] })],
		sequences: [{ id: 'main', trackIds: ['voice'] }], primarySequenceId: 'main',
		takeGroups: [{ id: 'comp', sequenceId: 'main', trackId: 'voice', startSample: 0, endSample: 4800,
			laneOrder: ['lane'], lanes: [{ id: 'lane' }], takes: [{ id: 'take', laneId: 'lane', sourceId: source.id, startSample: 0, endSample: 4800, sourceStartSample: 0 }],
			compRegions: [{ id: 'region', takeId: 'take', startSample: 0, endSample: 4800 }] }],
	});
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'flatten-fades' });
	const writer = await store.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(4800).fill(.25), new Float32Array(4800).fill(.25)]); await writer.commit();
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, projectRuntime: runtime,
		sessionController: runtime.createSessionController(), store, engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'], engineFactory: createMemoryRenderEngine as unknown as Options['engineFactory'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await controller.actions.project.open(project);
	await controller.actions.takeComp.flatten('comp');
	const clip = controller.project?.clips[0]; assert.ok(clip);
	assert.equal(clip.fadeInFrames, 0); assert.equal(clip.fadeOutFrames, 0);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.takeGroups, project.takeGroups);
	controller.actions.edit.redo(); assert.equal(controller.project?.clips[0]?.fadeInFrames, 0);
});
