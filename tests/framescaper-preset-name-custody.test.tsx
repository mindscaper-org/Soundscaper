/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperSelectedVisualAuthoringDialog from '../src/common/editor/ui/dialogs/FramescaperSelectedVisualAuthoringDialog.tsx';
import { bindFramescaperSelectedAuthoringController } from '../src/framescaper/editor-selected-finishing-authoring-controller.ts';
import { prepareFramescaperSelectedAuthoringFinishing } from '../src/framescaper/editor-selected-finishing-authoring-workflows.ts';
import { normalizeVideoGeneratorClipV1, normalizeVideoGeneratorSourceV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { normalizeVideoVisualPresetV1 } from '../src/common/editor/video-visual-preset-v24.ts';
import { cloneFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const firstName of ['Café', 'Cafe\u0301']) test(`preset ${JSON.stringify(firstName)} crosses the production dialog, controller, history and Scape model custody`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createEditorProjectRuntimeSelection(PROFILE);
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	const controller = createAudioEditorController(null, { headless: true, productId: 'framescaper', locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'],
		engineFactory: () => { throw new Error('Preset metadata custody must not synthesize video or audio.'); } });
	let unsubscribe = () => {};
	let cleanupView: () => Promise<void> = async () => {};
	context.after(async () => { await cleanupView(); await controller.dispose(); });
	await controller.ready;
	const generated = await prepareFramescaperSelectedAuthoringFinishing('video-solid', controller.project);
	await controller.actions.edit.commit(generated.command);
	const initial = cloneFramescaperProject(PROFILE, controller.project);
	const clip = normalizeVideoGeneratorClipV1(initial.clips[0]);
	assert.deepEqual([clip.sequenceStartFrame, clip.sequenceFrameCount, clip.sourceInFrame, clip.sourceFrameCount], [0, 150, 0, 150]);
	await controller.actions.timeline.selectClip(clip.id);
	bindFramescaperSelectedAuthoringController({ controller, store });
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as HTMLElement);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT, priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React }); globals.IS_REACT_ACT_ENVIRONMENT = true;
	cleanupView = async () => {
		unsubscribe(); await act(async () => { root.unmount(); });
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore();
	};
	const pending: Promise<unknown>[] = [];
	const render = (): void => root.render(<FramescaperSelectedVisualAuthoringDialog surface="video-visual-preset"
		controller={controller} project={controller.project} selectedClipId={clip.id} playheadSample={0}
		editingBlocked={false} readOnly={false} run={operation => { const work = Promise.resolve(operation()); pending.push(work); return work; }}
		onClose={() => {}} />);
	await act(async () => { render(); }); unsubscribe = controller.subscribe(render);
	for (const name of [firstName, 'Cafe\u0301 review']) {
		await act(async () => { reactProps(dom.one('[data-framescaper-authoring-preset-name]')).onChange({ currentTarget: { value: name } }); });
		await act(async () => {
			reactProps(dom.one('[data-framescaper-authoring-save-visual]')).onClick();
			await Promise.resolve();
			const work = pending.at(-1); assert.ok(work); await work;
		});
		assert.equal(dom.one('[data-framescaper-authoring-preset-name]').value, name, 'completed Save retains the authored typing draft');
	}
	const edited = cloneFramescaperProject(PROFILE, controller.project);
	assert.ok(Array.isArray(edited.videoVisualPresets));
	const presets = edited.videoVisualPresets.map(normalizeVideoVisualPresetV1);
	assert.deepEqual(presets.map(preset => preset.name), ['Café', 'Café review']);
	assert.deepEqual(dom.one('[data-framescaper-authoring-visual-preset]').querySelectorAll('option').map(option => option.textContent), ['None', 'Café', 'Café review']);
	assert.equal(edited.sources.length, 3); assert.equal(edited.projectBin.clips.length, 2);
	assert.equal(edited.clips.length, 1); assert.deepEqual(edited.clips[0], initial.clips[0]);
	assert.equal(new Set(presets.map(preset => preset.authoredStateSha256)).size, 2);
	for (const preset of presets) assert.match(preset.authoredStateSha256, /^[a-f\d]{64}$/u);
	for (const name of ['Café Model', 'Café review Model']) {
		const model = normalizeVideoGeneratorSourceV1(edited.sources.find(source => source.name === name));
		assert.deepEqual(model.generator, { kind: 'solid', color: '#000000ff' });
		assert.deepEqual([model.width, model.height, model.frameRate, model.frameCount], [1920, 1080, { num: 30, den: 1 }, 150]);
		assert.ok(edited.projectBin.clips.some(binClip => binClip.sourceId === model.id));
	}
	await act(async () => { await controller.actions.edit.undo(); });
	const undone = cloneFramescaperProject(PROFILE, controller.project);
	assert.ok(Array.isArray(undone.videoVisualPresets));
	assert.deepEqual(undone.videoVisualPresets.map(normalizeVideoVisualPresetV1).map(preset => preset.name), ['Café']);
	assert.equal(undone.sources.length, 2); assert.equal(undone.projectBin.clips.length, 1);
	await act(async () => { await controller.actions.edit.redo(); });
	const redone = cloneFramescaperProject(PROFILE, controller.project);
	assert.deepEqual(redone.videoVisualPresets, edited.videoVisualPresets); assert.deepEqual(redone.sources, edited.sources);
	await act(async () => { await controller.actions.project.flush(); });
	unsubscribe(); unsubscribe = () => {};
	assert.deepEqual(await store.loadProject(redone.id), redone);
	const archive = createFramescaperScapeNativeRuntime(PROFILE);
	const exported = await archive.exportScapeProject(redone, store); assert.ok(exported.blob);
	const recipient = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	context.after(async () => { await recipient.close(); });
	const result = await archive.importScapeProject(exported.blob, recipient); assert.equal(result.readOnly, false);
	const reopened = cloneFramescaperProject(PROFILE, result.project);
	assert.deepEqual(reopened, redone, 'preset names, hashes, generator model sources and Bin donors survive actual native Scape');
	assert.deepEqual(await recipient.loadProject(reopened.id), reopened);
});
