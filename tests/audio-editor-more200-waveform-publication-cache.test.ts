/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { loadNyquistWasm } from '../src/common/editor/nyquist/runtime.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const operation of ['tone', 'nyquist', 'invert'] as const) for (const failCache of [false, true]) {
	test(`${operation} publishes durable audio when optional waveform cache rejects=${String(failCache)}`, async context => {
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const archiveStore = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}:archive` });
		const source = createAudioSource({ id: 'original', name: 'Original.wav', frameCount: 4800, sampleRate: 48_000, channelCount: 1 });
		const writer = await archiveStore.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(4800).fill(.25)]); await writer.commit();
		const original = createSoundscaperProject({ id: context.name, ...(operation === 'invert' ? {
			sources: [source], clips: [createAudioClip({ id: 'clip', sourceId: source.id, title: 'Voice', durationFrames: 4800, sourceDurationFrames: 4800 })],
			tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })],
		} : {}) });
		const archive = await exportScapeProject(original, archiveStore); assert.ok(archive.blob instanceof Blob);
		await archiveStore.close();
		const runtime = createSoundscaperProjectRuntimeSelection();
		const nyquist = operation === 'nyquist' ? await loadNyquistWasm(readFileSync(new URL('../src/common/editor/nyquist/nyquist.wasm', import.meta.url))) : null;
		const options = { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
			renderSnapshot: async () => ({ length: 4800, sampleRate: 48_000, numberOfChannels: 1, getChannelData: () => new Float32Array(4800).fill(.25) }),
			...(nyquist ? { nyquistEvaluator: (request: Parameters<typeof nyquist.evaluate>[0]) => Promise.resolve(nyquist.evaluate(request)) } : {}),
		};
		const controller = createAudioEditorController(null, options);
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		await controller.actions.project.openScapeFile(new File([archive.blob], 'Healthy.sscape'), () => 'copy');
		const save = store.saveAnalysis.bind(store); let failures = 0;
		store.saveAnalysis = async (key: string, value: unknown) => {
			if (failCache && key.startsWith('audio-editor-peaks-v2:')) { failures++; throw new DOMException('Waveform cache full', 'QuotaExceededError'); }
			return save(key, value);
		};
		const before = controller.project; const history = controller.getSnapshot().history.undoEntries.length;
		if (operation === 'tone') await controller.actions.generators.generate('tone', { durationSeconds: .1, frequency: 440, amplitude: .4, channelCount: 1 });
		else if (operation === 'nyquist') await controller.actions.nyquist.evaluate({ source: '(scale .25 (osc 60 .1))', role: 'generate' });
		else {
			controller.actions.timeline.setExactSelection(0, 4800, { trackIds: ['voice'] });
			await controller.actions.effects.applySelection({ type: 'audacity-invert', params: {} });
		}
		assert.equal(failures > 0, failCache);
		const result = controller.project; assert.ok(result); assert.equal(result.clips.length, 1);
		const clip = result.clips[0]!; assert.notEqual(clip.sourceId, source.id);
		const published = result.sources.find(candidate => candidate.id === clip.sourceId); assert.ok(published);
		assert.equal(published.frameCount, 4800); assert.equal(published.sampleRate, 48_000);
		let frames = 0, peak = 0;
		for await (const chunk of store.readSourceChunks(String(published.storageKey))) {
			frames += chunk.frames;
			for (const sample of chunk.channels[0]!) peak = Math.max(peak, Math.abs(sample));
			if (operation === 'invert') assert.equal(chunk.channels[0]![0], -.25);
		}
		assert.equal(frames, 4800); assert.ok(peak > .1);
		assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
		controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before?.clips);
		controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, result.clips);
	});
}
