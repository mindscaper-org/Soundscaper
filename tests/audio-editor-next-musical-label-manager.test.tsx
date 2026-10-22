/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import WorkspacePanelContent from '../src/common/editor/ui/workspace/WorkspacePanelContent.jsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const projected of [false, true]) test(`Manage labels resolves authored musical bounds; supplied projection=${projected}`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.open(createSoundscaperProject({ id: 'musical-manager', sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [
			{ id: 'head', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
			{ id: 'change', beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } },
		] }, tracks: [{ id: 'labels', type: 'label', name: 'Cues', labels: [
			{ id: 'span', title: 'Across change', anchor: 'musical', startBeat: { num: 3, den: 1 }, endBeat: { num: 5, den: 1 } },
		] }] }));
	const project = controller.project; assert.ok(project);
	const originalTracks = structuredClone(project.tracks);
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => { root.render(<WorkspacePanelContent panelId="labels" controller={controller}
			snapshot={controller.getSnapshot()} runtimeProject={projected ? projectForRuntimeConsumers(project) : null}
			copy={{ ...COPY, select: 'Time selection' }} locale="en" run={(operation: () => unknown) => operation()} fileService={null}
			playbackMeterSettings={null} showArmControls={false} displayAudioSupported={false}
			onOpenEffects={() => undefined} effectsPanelTarget={null} onEffectWindowChange={() => undefined} blocked={false} />); });
		const row = dom.one('[data-label-id="span"]');
		const times = row.querySelectorAll('.timecode__display');
		assert.equal(times[0]?.textContent, '00h00m01.500s');
		assert.equal(times[1]?.textContent, '00h00m03.000s');
		const select = Array.from(row.querySelectorAll('button')).find(button => button.textContent === 'Time selection');
		assert.ok(select);
		await act(async () => { reactProps(select).onClick?.(); });
		assert.equal(controller.project?.selection.startFrame, 72_000);
		assert.equal(controller.project?.selection.endFrame, 144_000);
		assert.deepEqual(controller.project?.tracks, originalTracks, 'presentation and selection preserve persisted beat authority');
	} finally {
		await act(async () => root.unmount()); dom.restore();
		globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
