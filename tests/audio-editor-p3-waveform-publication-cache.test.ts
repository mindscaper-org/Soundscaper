/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryRenderEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const operation of ['resample', 'render'] as const) for (const failCache of [false, true]) test(`${operation} publishes committed PCM when optional waveform writes fail=${String(failCache)}`, async context => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const source = createAudioSource({ id: 'original', name: 'Original.wav', frameCount: 4800, sampleRate: 48_000, channelCount: 1 });
	const writer = await store.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(4800).fill(.25)]); await writer.commit();
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, title: 'Voice', sourceDurationFrames: 4800,
		durationFrames: operation === 'render' ? 2400 : 4800, speedRatio: operation === 'render' ? 2 : 1, linkPitchAndTempo: true });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		engineFactory: createMemoryRenderEngine as unknown as Options['engineFactory'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.open(createSoundscaperProject({ id: context.name, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice', clipIds: [clip.id] })] }));
	let failures = 0;
	const save = store.saveAnalysis.bind(store);
	store.saveAnalysis = async (key: string, value: unknown) => {
		if (failCache && key.startsWith('audio-editor-peaks-v2:')) { failures++; throw new DOMException('Waveform cache full', 'QuotaExceededError'); }
		return save(key, value);
	};
	const before = controller.project;
	const history = controller.getSnapshot().history.undoEntries.length;
	if (operation === 'resample') await controller.actions.clip.resample(clip.id, { sampleRate: 96_000 });
	else await controller.actions.clip.renderPitchSpeed(clip.id);
	assert.equal(failures > 0, failCache);
	const result = controller.project; assert.ok(result);
	const next = result.clips[0]; assert.ok(next); assert.notEqual(next.sourceId, source.id);
	const derived = result.sources.find(candidate => candidate.id === next.sourceId); assert.ok(derived);
	assert.equal(derived.sampleRate, operation === 'resample' ? 96_000 : 48_000);
	assert.equal(derived.frameCount, operation === 'resample' ? 9600 : 2400);
	let frames = 0;
	for await (const chunk of store.readSourceChunks(String(derived.storageKey))) {
		frames += chunk.frames;
		if (operation === 'resample') assert.ok(Math.abs(chunk.channels[0]![100]! - .25) < 1e-6);
	}
	assert.equal(frames, derived.frameCount); assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before?.clips);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, result.clips);
});
