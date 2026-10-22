/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MusicalTimelineControls } from '../src/common/editor/ui/toolbar/MusicalTimelineControls.jsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('MP62: opening another native project retires a focused musical tempo draft', async () => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: ENGLISH_COPY,
		store, projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	await controller.ready;
	await controller.actions.project.open(createSoundscaperProject({ id: 'tempo-replace-owner' }));
	const saved = controller.project; assert.ok(saved);
	const incoming = createSoundscaperProject({ id: 'incoming-tempo-project', title: 'Incoming programme' });
	const archive = await exportScapeProject(incoming, store); const archiveBlob = archive.blob; assert.ok(archiveBlob instanceof Blob);
	const incomingFile = new File([archiveBlob], 'Incoming.sscape');
	const dom = installReactTestDom(); const root = createRoot(dom.container as unknown as Element);
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React'); Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const render = () => { const snapshot = controller.getSnapshot(); root.render(<MusicalTimelineControls controller={controller} project={snapshot.project}
		snapshot={snapshot} copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()} />); };
	try {
		await act(async () => render());
		const field = dom.one('[data-action-id="playback-bpm"]').querySelector('input'); assert.ok(field);
		field.focus(); field.value = '200';
		await act(async () => {
			await controller.actions.project.openScapeFile(incomingFile, () => 'copy'); render();
		});
		assert.equal(controller.project?.id, incoming.id);
		const current = dom.one('[data-action-id="playback-bpm"]').querySelector('input'); assert.ok(current);
		await act(async () => reactProps(current).onBlur({ currentTarget: current }));
		assert.equal(controller.project?.tempoMap.events[0]?.bpm.num, 120, 'outgoing focused draft must not alter the reopened project');
	} finally {
		await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		dom.restore(); await controller.dispose();
	}
});
