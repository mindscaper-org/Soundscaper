/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import WorkspacePanelContent from '../src/common/editor/ui/workspace/WorkspacePanelContent.jsx';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { deliverySelectionArchive } from './helpers/more200-delivery-selection-fixture.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const kind of ['clip', 'time', 'empty'] as const) test(`Manage labels matches Add label for native ${kind} selection`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.openScapeFile(new File([await deliverySelectionArchive()], 'Selected take.sscape'), () => 'copy');
	if (kind === 'clip') controller.actions.timeline.selectClip('selected');
	else controller.actions.timeline.setExactSelection(kind === 'time' ? 1000 : 0, kind === 'time' ? 2000 : 0, { trackIds: ['voice'] });
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => { root.render(<WorkspacePanelContent panelId="labels" controller={controller}
			snapshot={controller.getSnapshot()} copy={{ ...COPY, newLabel: 'New label' }} locale="en" run={(operation: () => unknown) => operation()}
			fileService={null} playbackMeterSettings={null} showArmControls={false} displayAudioSupported={false}
			onOpenEffects={() => undefined} effectsPanelTarget={null} onEffectWindowChange={() => undefined} blocked={false} />); });
		const add = Array.from(dom.container.querySelectorAll('button')).find(button => button.textContent === 'New label');
		assert.ok(add); await act(async () => { reactProps(add).onClick(); });
		const exported = await controller.actions.labels.export({ download: false });
		const [start, end] = exported.text.split('\t').map(Number);
		const expectedFrames = kind === 'clip' ? [48_000, 72_000] : kind === 'time' ? [1000, 2000] : [0, 0];
		assert.equal(Math.round(start! * 48_000), expectedFrames[0]);
		assert.equal(Math.round(end! * 48_000), expectedFrames[1]);
		controller.actions.edit.undo(); assert.equal(controller.project?.tracks.some(track => track.type === 'label'), false);
		controller.actions.edit.redo(); assert.equal((await controller.actions.labels.export({ download: false })).text, exported.text);
	} finally { await act(async () => root.unmount()); dom.restore(); globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct; }
});
