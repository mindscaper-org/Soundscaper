/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import TimelineAnnotationWorkspacePanel from '../src/common/editor/ui/workspace/TimelineAnnotationWorkspacePanel.tsx';
import { TimelineAnnotationLayer } from '../src/common/editor/ui/timeline/TimelineAnnotationLayer.jsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

async function fixture(context: TestContext, surface: 'panel' | 'lane') {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	for (const id of ['first', 'second']) await store.saveProject(createSoundscaperProject({ id,
		sequences: [{ id: 'main', trackIds: [] }], primarySequenceId: 'main',
		timelineAnnotations: [{ id: 'marker', sequenceId: 'main', name: 'Original', color: 'auto', batchId: null,
			opaqueExtensions: {}, kind: 'marker', anchor: 'sample', positionFrame: 48_000 }],
	}));
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => {
		await act(async () => root.unmount()); await controller.dispose(); dom.restore();
		globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
	});
	await controller.ready; await controller.actions.project.openById('first');
	const render = async () => await act(async () => {
		const snapshot = controller.getSnapshot(); assert.ok(snapshot.project);
		root.render(surface === 'panel'
			? <TimelineAnnotationWorkspacePanel controller={controller} snapshot={snapshot} copy={ENGLISH_COPY} locale="en" run={operation => operation()} />
			: <TimelineAnnotationLayer controller={controller} project={snapshot.project} annotations={snapshot.timelineAnnotations}
				selectedAnnotationId={snapshot.selectedAnnotationId} copy={ENGLISH_COPY} locale="en" pixelsPerSecond={100}
				sampleRate={48_000} scrollX={0} viewportWidth={1000} blocked={false} run={(operation: () => unknown) => operation()}
				createAnnotation={() => undefined} />);
	});
	await render();
	if (surface === 'panel') Reflect.defineProperty(dom.one('input'), 'select', { value() {} });
	return { controller, dom, render, annotation: () => controller.project?.timelineAnnotations.find(value => value.id === 'marker') };
}

for (const surface of ['panel', 'lane'] as const) test(`MI27: an unfinished ${surface} marker rename cannot overwrite a replacement native project`, async context => {
	const f = await fixture(context, surface);
	await act(async () => { reactProps(f.dom.one('[data-annotation-id="marker"]')).onDoubleClick({}); });
	const input = f.dom.one('input');
	await act(async () => { reactProps(input).onChange({ target: { value: 'First project draft' } }); });
	await f.controller.actions.timeline.setExactSelection(12, 24); await f.render();
	assert.equal(f.dom.one('input').value, 'First project draft', 'same-project selection publications retain the edit');
	await f.controller.actions.project.openById('second'); await f.render();
	const current = f.dom.find('input');
	if (current) await act(async () => { reactProps(current).onBlur({ currentTarget: current }); });
	assert.equal(f.annotation()?.name, 'Original', 'the native replacement document must not receive the earlier marker draft');
});

test('MI27: a pending ruler marker drag retires when a replacement project has matching marker IDs and ranges', async context => {
	const f = await fixture(context, 'lane');
	const item = f.dom.one('[data-annotation-id="marker"]');
	const event = (clientX: number, node = item) => ({ pointerId: 1, button: 0, buttons: 1, isPrimary: true,
		pointerType: 'mouse', clientX, target: node, currentTarget: node, shiftKey: false, ctrlKey: false, metaKey: false,
		preventDefault() {}, stopPropagation() {} });
	await act(async () => { reactProps(item).onPointerDown(event(112)); reactProps(item).onPointerMove(event(150)); });
	await f.controller.actions.project.openById('second'); await f.render();
	const current = f.dom.one('[data-annotation-id="marker"]');
	await act(async () => { reactProps(current).onPointerUp(event(150, current)); });
	const annotation = f.annotation(); assert.ok(annotation && annotation.anchor === 'sample' && annotation.kind === 'marker');
	assert.equal(annotation.positionFrame, 48_000, 'pointer release cannot move the replacement project marker');
});
