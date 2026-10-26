/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadNyquistWasm } from '../src/common/editor/nyquist/runtime.js';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
test('NP053: Paste creates a valid new destination track below the default project rate', async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const archiveStore = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}:archive` });
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const original = createSoundscaperProject({ id: 'clipboard-rate-source', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	const writer = await archiveStore.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
	const archive = await exportScapeProject(original, archiveStore); assert.ok(archive.blob instanceof Blob);
	const destination = await exportScapeProject(createSoundscaperProject({ id: 'clipboard-24k', sampleRate: 24_000 }), archiveStore);
	assert.ok(destination.blob instanceof Blob);
	await archiveStore.close();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Hidden stretch.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	controller.actions.timeline.setExactSelection(0, 48_000, { trackIds: ['voice'] });
	controller.actions.edit.copy();
	await controller.actions.project.openScapeFile(new File([destination.blob], '24k.sscape'), () => 'copy');
	await controller.actions.edit.paste();
	const pasted: unknown = controller.project; assert.ok(validateSoundscaperProject(pasted));
	const clip = pasted.clips[0]; assert.ok(clip);
	assert.equal(pasted.sampleRate, 24_000); assert.equal(clip.durationFrames, 24_000);
	const track = pasted.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(clip.id)); assert.ok(track);
	const spectrogram = track.spectrogram;
	assert.ok(spectrogram !== null && typeof spectrogram === 'object' && 'maximumFrequency' in spectrogram);
	assert.equal(spectrogram.maximumFrequency, 12_000);
	controller.actions.edit.undo(); assert.equal(controller.project?.clips.length, 0);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, pasted.clips);
});

for (const action of ['bin', 'import', 'generate', 'move', 'duplicate-move', 'nyquist'] as const) test(`NP053: ${action} creates audio tracks on the native destination rate`, async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const archiveStore = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}:archive` });
	const source = createAudioSource({ id: 'source', sampleRate: 24_000, frameCount: 24_000, channelCount: 1 });
	const writer = await archiveStore.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(24_000).fill(.25)]); await writer.commit();
	const nyquist = action === 'nyquist' ? await loadNyquistWasm(readFileSync(new URL('../src/common/editor/nyquist/nyquist.wasm', import.meta.url))) : null;
	const project = createSoundscaperProject({ id: `low-rate-${action}`, sampleRate: 24_000,
		...((action === 'move' || action === 'duplicate-move') ? { sources: [source], clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 24_000, sourceDurationFrames: 24_000 })], tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] }, 24_000)] } : {}),
		...(action === 'bin' ? { sources: [source], projectBin: { clips: [createAudioClip({ id: 'bin-clip', binItemId: 'recording',
			sourceId: source.id, durationFrames: 24_000, sourceDurationFrames: 24_000 })] } } : {}) });
	const archive = await exportScapeProject(project, archiveStore); assert.ok(archive.blob instanceof Blob); await archiveStore.close();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		...(nyquist ? { nyquistEvaluator: (request: Parameters<typeof nyquist.evaluate>[0]) => Promise.resolve(nyquist.evaluate(request)) } : {}),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.openScapeFile(new File([archive.blob], '24k.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	if (action === 'bin') controller.actions.projectBin.place('bin-clip');
	else if (action === 'generate') await controller.actions.generators.generate('tone', { durationSeconds: 1, frequency: 440 });
	else if (action === 'move' || action === 'duplicate-move') controller.actions.clip.moveToNewTrack('clip', 0, { exactFrame: true, duplicate: action === 'duplicate-move' });
	else if (action === 'nyquist') await controller.actions.nyquist.evaluate({ source: '(osc 60 1)', role: 'generate' });
	else await controller.actions.project.importFiles([new File([new Uint8Array(encodeWav([new Float32Array(24_000).fill(.25)],
		{ sampleRate: 24_000, float: true }))], 'Recording.wav')], { destination: 'timeline' });
	assert.equal(controller.project?.clips.length, action === 'duplicate-move' ? 2 : 1, JSON.stringify(controller.getSnapshot().status));
	assert.equal(controller.project.clips[0]?.durationFrames, 24_000);
	controller.actions.edit.undo(); assert.equal(controller.project?.clips.length, action === 'move' || action === 'duplicate-move' ? 1 : 0);
	controller.actions.edit.redo(); assert.equal(controller.project?.clips.length, action === 'duplicate-move' ? 2 : 1);
});
