/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const sourceRate of [96_000, 48_000]) test(`legacy AUP ${sourceRate}Hz envelope retains its departing value after programme-grid conversion`, async context => {
	const frames = sourceRate / 100;
	const bytes = new Uint8Array(24 + frames * 4), view = new DataView(bytes.buffer);
	for (const [index, value] of [0x2e736e64, 24, frames * 4, 6, sourceRate, 1].entries()) view.setUint32(index * 4, value);
	for (let frame = 0; frame < frames; frame++) view.setFloat32(24 + frame * 4, .25);
	const envelope = [[0, .2], [1, .1], [2, .9], [frames, .9]];
	const xml = `<project rate="48000"><wavetrack name="Voice" channel="2" rate="${sourceRate}"><waveclip offset="0">`
		+ `<sequence numsamples="${frames}"><waveblock start="0"><simpleblockfile filename="e0000.au" len="${frames}"/></waveblock></sequence>`
		+ `<envelope numpoints="4">${envelope.map(([frame, value]) => `<controlpoint t="${frame! / sourceRate}" val="${value}"/>`).join('')}</envelope>`
		+ '</waveclip></wavetrack></project>';
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		adaptAudacityProject: importSoundscaperAudacityProject, projectRuntime: runtime, sessionController: runtime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.importFiles([new File([xml], 'Envelope.aup'), new File([bytes], 'e0000.au')]);
	const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
	const clip = project.clips[0]; assert.ok(clip?.kind === 'audio');
	assert.equal(clip.durationFrames, 480); assert.equal(clip.sourceDurationFrames, frames);
	assert.equal(clip.envelope.find(point => point.frame === (sourceRate === 96_000 ? 1 : 2))?.value, .9);
	assert.equal(clip.envelope[0]?.value, .2);
	const source = project.sources[0]; assert.ok(source);
	assert.equal((await store.readSourceChunk(source.storageKey, 0))?.channels[0]?.[0], .25);
});
