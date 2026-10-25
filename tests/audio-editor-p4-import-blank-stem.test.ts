/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { normalizeSourceProvenance } from '../src/common/editor/source-provenance.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const name of ['   .wav', '　.wav', '.wav', ' Voice .wav']) test(`File Import derives a usable track name from ${JSON.stringify(name)} without changing the selected filename`, async context => {
	const pcm = [new Float32Array(4800).fill(.25), new Float32Array(4800).fill(-.125)];
	const file = new File([Uint8Array.from(encodeWav(pcm, { sampleRate: 48_000, float: true }))], name, { type: 'audio/wav' });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const initial = controller.project; assert.ok(initial); const ordinal = initial.tracks.length + 1;
	await controller.actions.project.importFiles([file]);
	const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
	assert.equal(project.clips.length, 1, 'healthy PCM must not be discarded because its display-name stem is blank');
	const clip = project.clips[0]; assert.ok(clip?.kind === 'audio');
	const source = project.sources[0]; assert.ok(source?.kind === 'audio');
	const expected = name === ' Voice .wav' ? ' Voice ' : `Track ${String(ordinal)}`;
	assert.equal(project.tracks.find(track => track.type === 'audio' && track.clipIds.includes(clip.id))?.name, expected);
	assert.equal(clip.title, expected); assert.equal(source.name, name);
	const origin = normalizeSourceProvenance(source.provenance).contributions[0]?.origin; assert.ok(origin?.kind === 'local-file'); assert.equal(origin.originalFileName, name);
	const chunk = await store.readSourceChunk(source.storageKey, 0); assert.ok(chunk); assertPcmChannelsEqual(chunk.channels, pcm);
	await controller.actions.project.flush(); const saved: unknown = await store.loadProject(project.id); assert.ok(validateSoundscaperProject(saved)); assert.deepEqual(saved.tracks, project.tracks);
});
