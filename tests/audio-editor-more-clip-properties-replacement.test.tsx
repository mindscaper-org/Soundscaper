/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ClipPropertiesDialog from '../src/common/editor/ui/inspector/ClipPropertiesDialog.jsx';
import ClipPropertiesPanel from '../src/common/editor/ui/inspector/ClipPropertiesPanel.tsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createFixture, createAudioEditorController, createMemoryEngine, ENGLISH_COPY } from './helpers/audio-editor-nyquist-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const panel of [false, true]) test(`${panel ? 'panel' : 'dialog'} clip names retire on same-ID native file replacement`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorReact = globals.React, priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const fixture = await createFixture('property-replacement', { sampleRate: 8_000,
		tracks: [{ id: 'voice', name: 'Voice', input: new Float32Array(80) }] });
	await fixture.store.saveProject(createSoundscaperProject({ id: fixture.project.id, sampleRate: 8_000,
		sources: fixture.project.sources, tracks: fixture.project.tracks, clips: fixture.project.clips }));
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: ENGLISH_COPY,
		scapeProjectRuntime: createSoundscaperScapeNativeRuntime(), projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: fixture.store, engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await act(async () => root.unmount()); await controller.dispose();
		globals.React = priorReact; globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore(); });
	await controller.ready; await controller.actions.project.openById(fixture.project.id);
	controller.actions.timeline.selectClip('voice-clip');
	const render = async () => await act(async () => {
		const props = { controller, snapshot: controller.getSnapshot() as unknown as Parameters<typeof ClipPropertiesPanel>[0]['snapshot'], copy: ENGLISH_COPY };
		root.render(panel ? <ClipPropertiesPanel {...props} run={work => work()} /> : <ClipPropertiesDialog {...props} isOpen onClose={() => undefined} />);
	});
	const input = () => { const value = dom.one(panel ? '[data-clip-properties-field="name"]' : '[data-clip-field="name"]').querySelector('input'); assert.ok(value); return value; };
	await render();
	await act(async () => { reactProps(input()).onChange({ currentTarget: { value: 'Old draft' }, target: { value: 'Old draft' } }); });
	const saved = await fixture.store.loadProject(fixture.project.id); assert.ok(saved);
	const archive = await exportScapeProject(saved, fixture.store); const blob = archive.blob; assert.ok(blob instanceof Blob);
	const generation = controller.captureProjectGeneration().generation;
	await act(async () => {
		await controller.actions.project.openScapeFile(new File([blob], 'Replacement.sscape'), () => 'replace');
		controller.actions.timeline.selectClip('voice-clip');
	});
	assert.notEqual(controller.captureProjectGeneration().generation, generation);
	await render();
	assert.equal(input().value, 'Voice');
	await act(async () => { await reactProps(input()).onBlur({ currentTarget: input(), target: input() }); });
	assert.equal(controller.project?.clips[0]?.title, 'Voice');
});
