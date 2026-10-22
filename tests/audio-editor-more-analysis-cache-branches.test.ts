/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { audioBuffer, COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';

for (const type of ['levels', 'spectrum'] as const) {
	test(`Analyze ${type} recomputes reopened document branches with the same ID and revision`, async (context) => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const runtime = createSoundscaperProjectRuntimeSelection();
		const store = createMemoryStore();
		store.audioSources.set('source', [new Float32Array(4096).fill(0.5)]);
		const project = createSoundscaperProject({ id: `analysis-branches-${type}`,
			sources: [createAudioSource({ id: 'source', frameCount: 4096, channelCount: 1, sampleRate: 48_000 })],
			clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 4096, sourceDurationFrames: 4096 })],
			tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })] });
		let renders = 0;
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
			projectRuntime: runtime, sessionController: runtime.createSessionController(), store: store as unknown as Options['store'],
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
			renderSnapshot: async (snapshot: typeof project, range: { startFrame: number; endFrame: number }) => {
				renders++;
				const pcm = Float32Array.from({ length: range.endFrame - range.startFrame }, (_, frame) =>
					0.5 * snapshot.master.gain * Math.sin(2 * Math.PI * 1000 * frame / snapshot.sampleRate));
				return audioBuffer([pcm], snapshot.sampleRate);
			} });
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		const analyze = async () => type === 'levels' ? controller.actions.analysis.run('master')
			: controller.actions.analysis.plotSpectrum('master');
		await store.saveProject(project);
		await controller.actions.project.open(project);
		controller.actions.effects.setMasterGain(0.5);
		controller.actions.timeline.setSelection(0, 4096);
		const firstRevision = controller.project!.revision;
		const first = await analyze();
		assert.ok(first);
		assert.equal(renders, 1);
		await analyze();
		assert.equal(renders, 1, 'an unchanged branch still uses its analysis cache');
		// File/Open restores the saved snapshot, then a different edit revisits the
		// same numeric revision without revisiting the same authored mix.
		await controller.actions.project.close(project.id, { discard: true });
		await store.saveProject(project);
		await controller.actions.project.open(project);
		controller.actions.effects.setMasterGain(0.25);
		controller.actions.timeline.setSelection(0, 4096);
		assert.equal(controller.project!.revision, firstRevision);
		const second = await analyze();
		assert.ok(second);
		assert.equal(renders, 2, 'same project ID/revision does not attest equal rendered content');
		assert.notDeepEqual(second, first);
	});
}
