/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const [sourceRate, offset] of [[48_000, -.1], [96_000, -.1], [48_000, 0], [48_000, -.3]] as const) {
	test(`legacy AUP ${sourceRate}Hz clip at ${offset}s preserves its visible source window`, async context => {
		const frames = sourceRate / 5;
		const bytes = new Uint8Array(24 + frames * 4), view = new DataView(bytes.buffer);
		for (const [index, value] of [0x2e736e64, 24, frames * 4, 6, sourceRate, 1].entries()) view.setUint32(index * 4, value);
		for (let frame = 0; frame < frames; frame++) view.setFloat32(24 + frame * 4, frame < frames / 2 ? .25 : -.125);
		const envelope = [[0, .2], [frames / 2, .6], [frames, .8]];
		const xml = `<project rate="48000"><wavetrack name="Voice" channel="2" rate="${sourceRate}"><waveclip name="Voice" offset="${offset}">`
			+ `<sequence numsamples="${frames}"><waveblock start="0"><simpleblockfile filename="e0000.au" len="${frames}"/></waveblock></sequence>`
			+ `<envelope numpoints="3">${envelope.map(([frame, value]) => `<controlpoint t="${frame! / sourceRate}" val="${value}"/>`).join('')}</envelope>`
			+ '</waveclip></wavetrack></project>';
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			adaptAudacityProject: importSoundscaperAudacityProject, projectRuntime: runtime, sessionController: runtime.createSessionController(),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		await controller.actions.project.importFiles([new File([xml], 'Before zero.aup'), new File([bytes], 'e0000.au')]);
		const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
		if (offset === -.3) {
			assert.equal(project.clips.length, 0, 'a wholly hidden recording must never be shifted into the programme');
			assert.equal(project.projectBin.clips.length, 1, 'retain fully hidden media in the existing Project Bin');
			assert.equal(project.projectBin.clips[0]?.durationFrames, 9600);
			assert.equal(project.projectBin.clips[0]?.sourceStartFrame, 0);
		} else {
			const clip = project.clips[0]; assert.ok(clip?.kind === 'audio');
			assert.equal(clip.timelineStartFrame, 0);
			assert.equal(clip.durationFrames, offset < 0 ? 4800 : 9600);
			assert.equal(clip.sourceStartFrame, offset < 0 ? frames / 2 : 0);
			assert.equal(clip.sourceDurationFrames, offset < 0 ? frames / 2 : frames);
			assert.equal(clip.trimStartFrames, clip.sourceStartFrame);
			assert.equal(clip.envelope[0]?.value, offset < 0 ? .6 : .2);
		}
		const source = project.sources[0]; assert.ok(source?.kind === 'audio');
		assert.equal(source.frameCount, frames); assert.equal(source.sampleRate, sourceRate);
		const stored = await store.readSourceChunk(source.storageKey, 0); assert.ok(stored);
		assert.equal(stored.channels[0]?.[0], .25); assert.equal(stored.channels[0]?.at(-1), -.125);

		if (offset < 0) {
			const extensions = project.opaqueExtensions;
			assert.ok(extensions && typeof extensions === 'object' && 'legacyAupWarnings' in extensions);
			assert.match(JSON.stringify(extensions.legacyAupWarnings), /before time zero/u);
		}
		await controller.actions.project.flush();
		const saved: unknown = await store.loadProject(project.id); assert.ok(validateSoundscaperProject(saved));
		assert.deepEqual(saved.clips, project.clips); assert.deepEqual(saved.sources, project.sources);
		assert.deepEqual(saved.projectBin, project.projectBin);
	});
}
