/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AnalysisDialog from '../src/common/editor/ui/dialogs/AnalysisDialog.jsx';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { audioBuffer, COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const cases = [
	{ mode: 'levels', lost: 'Unused.wav' }, { mode: 'contrast', lost: 'Unused.wav' },
	{ mode: 'levels', lost: 'Programme.wav' },
] as const;
for (const { mode, lost } of cases) test(`Analyze ${mode} fences only timeline media after ${lost} is evicted`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const databaseName = `analysis-unused-${mode}-${lost}`;
	let store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const createController = () => createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		renderSnapshot: async () => audioBuffer([new Float32Array(48_000).fill(.25)], 48_000) });
	let controller = createController();
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const wav = Uint8Array.from(encodeWav([new Float32Array(48_000).fill(.25)], { sampleRate: 48_000, dither: false }));
	await controller.actions.project.importFiles([new File([wav], 'Programme.wav')], { destination: 'timeline' });
	await controller.actions.project.importFiles([new File([wav], 'Unused.wav')], { destination: 'project-bin' });
	await controller.actions.project.save();
	const saved = controller.getSnapshot().project;
	assert.ok(validateSoundscaperProject(saved));
	const unused = saved.sources.find(source => source.name === 'Unused.wav'); assert.ok(unused);
	const missing = saved.sources.find(source => source.name === lost); assert.ok(missing);
	assert.ok(saved.projectBin.clips.some(clip => clip.sourceId === unused.id));
	assert.ok(saved.clips.every(clip => clip.sourceId !== unused.id));
	await controller.dispose();
	store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName });
	// Model storage eviction below the guarded product deletion API, retaining
	// the genuine saved programme and its original Bin reference.
	store.memory.sources.delete(missing.storageKey ?? missing.id);
	controller = createController();
	await controller.ready;
	await controller.actions.project.open(saved);
	controller.actions.timeline.setSelection(0, 48_000);
	assert.deepEqual(controller.getSnapshot().missingSourceIds, [missing.id]);
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT, priorReact = globals.React;
	globals.IS_REACT_ACT_ENVIRONMENT = true; globals.React = React;
	const root = createRoot(dom.container as unknown as Element);
	let settled = Promise.resolve<unknown>(null);
	const port = { actions: { analysis: {
		run: () => { settled = Promise.resolve(controller.actions.analysis.run('master')); return settled; },
		contrast: (role: 'foreground' | 'background') => { settled = Promise.resolve(controller.actions.analysis.contrast(role, 'master')); return settled; },
	} } };
	try {
		await act(async () => { root.render(<AnalysisDialog mode={mode} controller={port} snapshot={controller.getSnapshot()}
			copy={ENGLISH_COPY} fileService={{}} onClose={() => undefined} />); });
		if (mode === 'contrast') {
			const button = dom.container.querySelectorAll('button').find(node => node.textContent === ENGLISH_COPY.captureContrastForeground);
			assert.ok(button); assert.equal(button.disabled, false, 'unused media must not disable foreground capture');
			await act(async () => { reactProps(button).onClick?.(); });
		}
		await act(async () => { await settled; });
		if (lost === 'Programme.wav') assert.equal(dom.find('[data-analysis-report]'), null, 'missing programme audio still blocks analysis');
		else assert.ok(dom.find(`[data-analysis-report="${mode}"]`), 'the healthy programme must produce its measurement');
		assert.equal(dom.find('[role="alert"]'), null);
	} finally {
		await act(async () => { root.unmount(); });
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct; globals.React = priorReact; dom.restore();
	}
});
