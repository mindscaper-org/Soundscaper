/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadNyquistWasm } from '../src/common/editor/nyquist/runtime.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioEditorController, createMemoryEngine, createFixture, ENGLISH_COPY } from './helpers/audio-editor-nyquist-controller-harness.js';

for (const scenario of ['another-sequence', 'locked', 'explicit-label', 'fallback'] as const) test(`Nyquist label destination honors ${scenario}`, async () => {
	const locked = scenario === 'locked';
	const newPeer = scenario === 'fallback';
	const input = new Float32Array(8_000);
	const { store, project } = await createFixture('nyquist-label-target', { sampleRate: 8_000,
		tracks: [{ id: 'voice', name: 'Voice', input }] });
	await store.saveProject(createSoundscaperProject({ id: project.id, title: project.title, sampleRate: project.sampleRate, sources: project.sources, clips: project.clips,
		primarySequenceId: 'visible', sequences: [
			{ id: 'other', rate: { num: 25, den: 1 }, trackIds: newPeer ? ['voice'] : locked ? [] : ['other-labels'] },
			{ id: 'visible', rate: { num: 25, den: 1 }, trackIds: newPeer ? ['other-labels', 'visible-labels'] : locked ? ['other-labels', 'voice', 'visible-labels'] : ['voice', 'visible-labels'] },
		], tracks: [
			...(newPeer ? project.tracks : []),
			{ id: 'other-labels', type: 'label', locked: locked || newPeer, labels: [] },
			...(newPeer ? [] : project.tracks),
			{ id: 'visible-labels', type: 'label', labels: [] },
		],
	}));
	const runtime = await loadNyquistWasm(readFileSync(new URL('../src/common/editor/nyquist/nyquist.wasm', import.meta.url)));
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const options = { headless: true, productId: 'soundscaper', copy: ENGLISH_COPY, locale: 'en',
		store, projectRuntime, sessionController: projectRuntime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: { dispose() {} } as unknown as Options['ffmpeg'],
		nyquistEvaluator: (request: Parameters<typeof runtime.evaluate>[0]) => Promise.resolve(runtime.evaluate(request)),
		renderSnapshot: async () => ({ length: input.length, sampleRate: 8_000, numberOfChannels: 1, getChannelData: () => input }),
	};
	const controller = createAudioEditorController(null, options);
	await controller.ready; await controller.actions.project.openById(project.id);
	try {
		controller.actions.timeline.selectTrack('voice');
		controller.actions.timeline.setSelection(0, input.length, { trackIds: ['voice'], clipIds: [] });
		if (scenario === 'explicit-label') controller.actions.timeline.selectTrack('other-labels');
		await controller.actions.nyquist.evaluate({ source: "'((0.1 0.2 \"Speech\"))", role: 'prompt' });
		const tracks = controller.getSnapshot().project?.tracks as readonly Readonly<{ id: string; labels?: readonly unknown[] }>[] | undefined;
		assert.ok(tracks);
		assert.equal(tracks.find(track => track.id === 'visible-labels')?.labels?.length, scenario === 'explicit-label' ? 0 : 1);
		assert.equal(tracks.find(track => track.id === 'other-labels')?.labels?.length, scenario === 'explicit-label' ? 1 : 0);
	} finally { await controller.dispose(); }
});
