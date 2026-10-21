/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import WorkspacePanelContent from '../src/common/editor/ui/workspace/WorkspacePanelContent.jsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('MI23: a Labels panel title draft cannot overwrite a different reopened project with matching label IDs', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'label-panel-project-draft' });
	for (const id of ['first', 'second']) await store.saveProject(createSoundscaperProject({ id,
		tracks: [{ id: 'labels', type: 'label', name: 'Labels', labels: [{ id: 'intro', title: 'Original', startFrame: 0, endFrame: 48_000 }] }],
	}));
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
	});
	context.after(async () => { await controller.dispose(); });
	const render = () => root.render(<WorkspacePanelContent panelId="labels" controller={controller}
		snapshot={controller.getSnapshot()} copy={COPY} locale="en" run={(operation: () => unknown) => operation()}
		fileService={null} playbackMeterSettings={null} showArmControls={false} displayAudioSupported={false}
		onOpenEffects={() => undefined} effectsPanelTarget={null} onEffectWindowChange={() => undefined} blocked={false} />);
	const input = () => {
		const node = dom.one('[data-label-id="intro"]').querySelector('input'); assert.ok(node); return node;
	};
	try {
		await controller.ready;
		await controller.actions.project.openById('first');
		await act(async () => { render(); });
		await act(async () => { reactProps(input()).onChange({ currentTarget: { value: 'Uncommitted first-project draft' } }); });
		await controller.actions.timeline.setExactSelection(12, 24);
		await act(async () => { render(); });
		assert.equal(input().value, 'Uncommitted first-project draft', 'ordinary publications retain the same project draft');
		await controller.actions.project.openById('second');
		await act(async () => { render(); });
		await act(async () => { reactProps(input()).onBlur({ currentTarget: input() }); });
		const track = controller.project?.tracks.find(candidate => candidate.id === 'labels'); assert.ok(track);
		const labels: unknown = Reflect.get(track, 'labels'); assert.ok(Array.isArray(labels));
		const label: unknown = labels[0]; assert.ok(label && typeof label === 'object' && 'title' in label);
		assert.equal(label.title, 'Original', 'the native second project must not receive a stale first-project edit');
		assert.equal(input().value, 'Original');
	} finally {
		await act(async () => root.unmount());
		dom.restore(); globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
