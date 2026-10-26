/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { convertLegacyAupToProject } from '../src/common/editor/aup-legacy-conversion.js';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const gain of [8, 10 ** (36 / 20), 64, 4, 1, 0]) {
	test(`legacy AUP fader gain ${gain} preserves its audible level without rewriting PCM`, async context => {
		const sourceRate = 48_000, frames = 4800;
		const bytes = new Uint8Array(24 + frames * 4), view = new DataView(bytes.buffer);
		for (const [index, value] of [0x2e736e64, 24, frames * 4, 6, sourceRate, 1].entries()) view.setUint32(index * 4, value);
		for (let frame = 0; frame < frames; frame++) view.setFloat32(24 + frame * 4, .002);
		const envelope = [[0, .5], [frames, 1]];
		const xml = `<project rate="48000"><wavetrack name="Voice" channel="2" rate="${sourceRate}" gain="${gain}"><waveclip name="Voice" offset="0">`
			+ `<sequence numsamples="${frames}"><waveblock start="0"><simpleblockfile filename="e0000.au" len="${frames}"/></waveblock></sequence>`
			+ `<envelope numpoints="2">${envelope.map(([frame, value]) => `<controlpoint t="${frame! / sourceRate}" val="${value}"/>`).join('')}</envelope>`
			+ '</waveclip></wavetrack></project>';
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			adaptAudacityProject: importSoundscaperAudacityProject, projectRuntime: runtime, sessionController: runtime.createSessionController(),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		await controller.actions.project.importFiles([new File([xml], 'Fader gain.aup'), new File([bytes], 'e0000.au')]);
		const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
		const track = project.tracks.find(track => track.type === 'audio'); assert.ok(track?.type === 'audio');
		const clip = project.clips[0]; assert.ok(clip?.kind === 'audio');
		assert.equal(track.gain * clip.gain, gain, 'the documented Audacity fader range must not become unity');
		assert.equal(clip.durationFrames, frames); assert.equal(clip.sourceStartFrame, 0);
		assert.equal(clip.envelope[0]?.value, .5);
		const source = project.sources[0]; assert.ok(source?.kind === 'audio');
		const stored = await store.readSourceChunk(source.storageKey, 0); assert.ok(stored);
		assert.equal(stored.channels[0]?.[0], Math.fround(.002)); assert.equal(stored.channels[0]?.at(-1), Math.fround(.002));
		if (gain > 4) {
			const extensions = project.opaqueExtensions;
			assert.ok(extensions && typeof extensions === 'object' && 'legacyAupWarnings' in extensions);
			assert.match(JSON.stringify(extensions.legacyAupWarnings), /gain.*clip gain/u);
		}

		await controller.actions.project.flush();
		const saved: unknown = await store.loadProject(project.id); assert.ok(validateSoundscaperProject(saved));
		assert.deepEqual(saved.clips, project.clips); assert.deepEqual(saved.sources, project.sources);
		assert.deepEqual(saved.projectBin, project.projectBin);
	});
}


test('legacy AUP gain beyond the existing combined native range refuses before publishing audio', () => {
	assert.throws(() => convertLegacyAupToProject({ sampleRate: 48_000, tracks: [{
		type: 'audio', name: 'Voice', gain: 65, rate: 48_000,
		clips: [{ channels: [Float32Array.of(.002)], startSeconds: 0 }],
	}] }), /gain exceeds the supported combined track and clip gain range/u);
});
