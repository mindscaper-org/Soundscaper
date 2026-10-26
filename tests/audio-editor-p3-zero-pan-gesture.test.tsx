/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TrackControls } from '../src/common/editor/ui/timeline/TrackControls.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const pan of [.123456, .12]) test(`a zero-distance native knob move preserves authored pan ${pan}`, async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const engine = { ...createMemoryEngine(), previewScheduledParameter() {} };
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: engine as unknown as Options['engine'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.open(createSoundscaperProject({ id: 'zero-pan', tracks: [createAudioTrack({ id: 'voice', name: 'Voice', pan })] }));
	const before = controller.project; assert.ok(before);
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const beforeReact = globals.React, beforeAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	context.after(async () => { await act(async () => root.unmount()); dom.restore(); globals.React = beforeReact; globals.IS_REACT_ACT_ENVIRONMENT = beforeAct; });
	await act(async () => root.render(<TrackControls controller={controller} track={before.tracks[0]}
		trackHeight={180} panelWidth={240} selected blocked={false} showArmControls={false} displayAudioSupported={false}
		recordingInputs={[]} automationTargets={[]} automationTarget={undefined} automationRuntime={undefined}
		isFlatNavigation={false} copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()}
		onMenu={() => undefined} onOpenEffects={() => undefined} onAutomationTarget={() => undefined}
		onTabOut={() => undefined} onShiftTabOut={() => undefined} onNavigateVertical={() => undefined} />));
	const input = dom.one('.knob');
	Object.assign(input, { setPointerCapture() {}, hasPointerCapture() { return true; }, releasePointerCapture() {} });
	const pointer = { pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse', isPrimary: true, currentTarget: input, clientX: 30, clientY: 30, preventDefault() {}, stopPropagation() {} };
	await act(async () => reactProps(input).onPointerDown?.(pointer));
	await act(async () => reactProps(input).onPointerMove?.(pointer));
	await act(async () => reactProps(input).onPointerUp?.({ ...pointer, buttons: 0 }));
	assert.equal(controller.project?.tracks[0]?.pan, pan);
	assert.equal(controller.project?.revision, before.revision, 'an unchanged pointer position must not add an Undo step');
	await act(async () => reactProps(input).onPointerDown?.(pointer));
	await act(async () => reactProps(input).onPointerMove?.({ ...pointer, clientX: 50 }));
	await act(async () => reactProps(input).onPointerUp?.({ ...pointer, buttons: 0 }));
	assert.equal(controller.project?.tracks[0]?.pan, .32);
	controller.actions.edit.undo(); assert.equal(controller.project?.tracks[0]?.pan, pan);
	const key = { key: 'ArrowRight', preventDefault() {}, stopPropagation() {} };
	await act(async () => reactProps(input).onKeyDown?.(key));
	await act(async () => reactProps(input).onKeyUp?.(key));
	assert.ok(Math.abs(Number(controller.project?.tracks[0]?.pan) - (pan + .01)) < 1e-12);
	controller.actions.edit.undo(); assert.equal(controller.project?.tracks[0]?.pan, pan);
});
