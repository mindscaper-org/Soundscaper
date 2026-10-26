/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import MasterGainControl from '../src/common/editor/ui/inspector/MasterGainControl.tsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const gain of [.8, .0008]) test(`an idle Master gain gesture preserves the exact ${gain} programme gain`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const engine = { ...createMemoryEngine(), previewScheduledParameter() {} };
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: engine as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.open(createSoundscaperProject({ id: 'idle-master', master: { gain, effects: [] } }));
	const before = controller.project;
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const beforeReact = globals.React, beforeAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	context.after(async () => { await act(async () => root.unmount()); dom.restore(); globals.React = beforeReact; globals.IS_REACT_ACT_ENVIRONMENT = beforeAct; });
	await act(async () => root.render(<MasterGainControl actions={controller.actions.mixer} projectId={controller.project!.id}
		gain={gain} label="Master gain" disabled={false} onError={error => { throw error; }} />));
	const pointer = { pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse', isPrimary: true, preventDefault() {} };
	await act(async () => reactProps(dom.one('input')).onPointerDown?.(pointer));
	await act(async () => reactProps(dom.one('input')).onPointerUp?.({ ...pointer, buttons: 0 }));
	assert.equal(controller.project!.master.gain, gain);
	assert.equal(controller.project!.revision, before!.revision, 'no input event must not create an Undo entry');
	await act(async () => reactProps(dom.one('input')).onPointerDown?.(pointer));
	await act(async () => reactProps(dom.one('input')).onChange?.({ currentTarget: { value: '-6' } }));
	await act(async () => reactProps(dom.one('input')).onPointerUp?.({ ...pointer, buttons: 0 }));
	assert.equal(controller.project!.master.gain, 10 ** (-6 / 20), 'an actual level edit still commits');
	await controller.actions.edit.undo();
	assert.equal(controller.project!.master.gain, gain, 'Undo restores all authored precision');
});
