/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperSelectedVisualAuthoringDialog from '../src/common/editor/ui/dialogs/FramescaperSelectedVisualAuthoringDialog.tsx';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { bindFramescaperSelectedAuthoringController, framescaperSelectedVisualAuthoringRuntimeFor } from '../src/framescaper/editor-selected-finishing-authoring-controller.ts';
import { createFramescaperSelectedVisualAuthoringModel } from '../src/framescaper/editor-selected-finishing-visual-authoring-model.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { bindFramescaperSelectedFreezeCaptureFinishing } from '../src/framescaper/editor-selected-finishing-freeze-capture.ts';
import { createMemoryProjectStore } from './helpers/memory-project-store.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('a Freeze Frame capture from the previous project leaves the newly opened dialog usable', async context => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	let project = createFramescaperProject(PROFILE, framescaperBaselineOptions());
	let started!: () => void;
	let failCapture!: (error: Error) => void;
	const captureStarted = new Promise<void>(resolve => { started = resolve; });
	const oldCapture = new Promise<never>((_resolve, reject) => { failCapture = reject; });
	const controller = {
		get project() { return project; }, getSnapshot: () => ({ selectedClipId: 'video-clip' }),
		getTelemetrySnapshot: () => ({ positionFrame: 0 }), actions: { edit: { commit: () => assert.fail('Retired capture committed') } },
	};
	const projectRuntime = createEditorProjectRuntimeSelection(PROFILE);
	bindFramescaperSelectedAuthoringController({ controller,
		store: createMemoryProjectStore(context, 'visual-authoring-scope'),
		projectForRuntimeConsumers: projectRuntime.projectForRuntimeConsumers });
	const release = bindFramescaperSelectedFreezeCaptureFinishing(controller, {
		async capture() { started(); return await oldCapture; },
	});
	const render = () => root.render(<FramescaperSelectedVisualAuthoringDialog surface="video-freeze"
		project={project} controller={controller} selectedClipId="video-clip" playheadSample={0}
		editingBlocked={false} readOnly={false} run={operation => operation()} onClose={() => undefined} />);
	try {
		await act(async () => { render(); });
		await act(async () => { reactProps(dom.one('[data-framescaper-authoring-freeze]')).onClick(); await captureStarted; });
		assert.equal(reactProps(dom.one('fieldset')).disabled, true);
		project = createFramescaperProject(PROFILE, { ...framescaperBaselineOptions(), id: 'replacement' });
		await act(async () => { render(); });
		assert.equal(reactProps(dom.one('fieldset')).disabled, false);
		await act(async () => { failCapture(new Error('Old project could not capture.')); });
		assert.doesNotMatch(dom.container.textContent, /Old project could not capture/u);
		assert.equal(reactProps(dom.one('fieldset')).disabled, false);
	} finally {
		await act(async () => { failCapture(new Error('Capture retired.')); root.unmount(); });
		release(); dom.restore(); globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});

test('a moving playhead does not make the selected clip adjustment stale', async context => {
	let project = createFramescaperProject(PROFILE, framescaperBaselineOptions());
	let playhead = 0;
	const surface = 'video-adjustment-layer';
	const controller = { get project() { return project; }, getSnapshot: () => ({ selectedClipId: 'video-clip' }),
		getTelemetrySnapshot: () => ({ positionFrame: playhead }), actions: { edit: { commit(command: unknown) {
			project = applyFramescaperProjectCommand(PROFILE, project, command);
		} } } };
	bindFramescaperSelectedAuthoringController({ controller, store: createMemoryProjectStore(context, 'visual-playhead-scope') });
	const model = createFramescaperSelectedVisualAuthoringModel({ surface, project, selectedClipId: 'video-clip', playheadSample: playhead });
	const runtime = framescaperSelectedVisualAuthoringRuntimeFor(controller);
	assert.ok(runtime);
	playhead = 4_800;
	await runtime.run(surface, { fence: model.fence, operation: 'apply', clipId: 'video-clip', brightness: 0.3 });
	assert.ok(Array.isArray(project.videoAdjustmentLayers) && project.videoAdjustmentLayers.length === 1);
});
