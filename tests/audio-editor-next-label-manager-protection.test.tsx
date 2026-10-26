/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import WorkspacePanelContent from '../src/common/editor/ui/workspace/WorkspacePanelContent.jsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const blocked of [false, true]) test(`Manage labels honors host locks and workspace blocking=${blocked}`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.open(createSoundscaperProject({ id: 'protected-manager', tracks: [
		{ id: 'locked', type: 'label', name: 'Protected cues', locked: true, labels: [{ id: 'keep', title: 'Keep me', startFrame: 0, endFrame: 48_000 }] },
		{ id: 'editable', type: 'label', name: 'Editable cues', labels: [{ id: 'edit', title: 'Edit me', startFrame: 0, endFrame: 48_000 }] },
	] }));
	controller.actions.timeline.selectTrack('locked');
	assert.throws(() => controller.actions.labels.update('locked', 'keep', { title: 'Forbidden' }), /locked/u);
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	try {
		await act(async () => root.render(<WorkspacePanelContent panelId="labels" controller={controller}
			snapshot={controller.getSnapshot()} copy={{ ...COPY, ...ENGLISH_COPY, select: 'Time selection' }} locale="en"
			run={(operation: () => unknown) => operation()} fileService={null} playbackMeterSettings={null}
			showArmControls={false} displayAudioSupported={false} onOpenEffects={() => undefined}
			effectsPanelTarget={null} onEffectWindowChange={() => undefined} blocked={blocked} />));
		for (const id of ['keep', 'edit']) {
			const row = dom.one(`[data-label-id="${id}"]`);
			const title = row.querySelector('input'); assert.ok(title);
			assert.equal(reactProps(title).disabled, blocked || id === 'keep', 'protected labels must not offer a draft that cannot be committed');
			const remove = row.querySelector('.kw-audio-editor__workspace-panel-close'); assert.ok(remove);
			assert.equal(reactProps(remove).disabled, blocked || id === 'keep');
			const select = row.querySelectorAll('button').find(button => button.textContent === 'Time selection'); assert.ok(select);
			assert.equal(reactProps(select).disabled, blocked, 'a host track lock still allows selecting its range');
		}
		const add = dom.container.querySelectorAll('button').find(button => button.textContent === ENGLISH_COPY.newLabel); assert.ok(add);
		assert.equal(reactProps(add).disabled, true, 'an explicitly focused locked label track must not offer Add');
	} finally {
		await act(async () => root.unmount()); dom.restore(); globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
