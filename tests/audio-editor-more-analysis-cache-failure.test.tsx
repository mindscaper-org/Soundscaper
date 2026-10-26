/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import AnalysisDialog from '../src/common/editor/ui/dialogs/AnalysisDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { audioBuffer, COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const failure of ['read', 'write'] as const) test(`Analyze selection remains usable when its optional cache ${failure} fails`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `analysis-cache-failure-${failure}` }), runtime = createSoundscaperProjectRuntimeSelection();
	const options = { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store: store as unknown as Options['store'],
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		renderSnapshot: async () => audioBuffer([new Float32Array(48_000).fill(0.25)], 48_000) };
	const controller = createAudioEditorController(null, options as unknown as Options);
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('silence', { durationSeconds: 1, channelCount: 1 });
	controller.actions.timeline.setSelection(0, 48_000);
	const load = store.loadAnalysis.bind(store), save = store.saveAnalysis.bind(store);
	store.loadAnalysis = async key => {
		if (failure === 'read' && key.startsWith('audio-editor-analysis-v5:')) throw new DOMException('Cache database unavailable', 'InvalidStateError');
		return load(key);
	};
	store.saveAnalysis = async (key, value) => {
		if (failure === 'write' && key.startsWith('audio-editor-analysis-v5:')) throw new DOMException('Cache quota exceeded', 'QuotaExceededError');
		return save(key, value);
	};
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; React?: typeof React };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT, priorReact = globals.React;
	globals.IS_REACT_ACT_ENVIRONMENT = true; globals.React = React;
	const root = createRoot(dom.container as unknown as Element), downloads: unknown[] = [];
	let settled = Promise.resolve<unknown>(null);
	const dialogController = { actions: { analysis: { run: () => { settled = Promise.resolve(controller.actions.analysis.run('master')); return settled; } } } };
	try {
		await act(async () => {
			root.render(<AnalysisDialog mode="levels" controller={dialogController} snapshot={controller.getSnapshot()} copy={ENGLISH_COPY}
				fileService={{ saveFile: (request: unknown) => { downloads.push(request); } }} onClose={() => undefined} />);
		});
		await act(async () => { await settled; });
		assert.ok(dom.find('[data-analysis-report="levels"]'), 'a cache failure must not discard the calculated measurement');
		assert.equal(dom.find('[role="alert"]'), null);
		const exportButton = dom.container.querySelectorAll('button').find(node => node.textContent === ENGLISH_COPY.export); assert.ok(exportButton);
		await act(async () => { reactProps(exportButton).onClick?.(); });
		assert.equal(downloads.length, 1, 'the report remains exportable');
		const remembered: unknown = controller.getSnapshot().lastAnalysisRequest;
		assert.ok(remembered && typeof remembered === 'object' && 'type' in remembered);
		assert.equal(remembered.type, 'levels');
	} finally {
		await act(async () => { root.unmount(); });
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct; globals.React = priorReact;
		dom.restore();
	}
});
