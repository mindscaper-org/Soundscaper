/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMenuActionFixture, findMenuItem } from './helpers/application-menu-fixture.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import EditorDialog from '../src/common/editor/ui/dialogs/EditorDialog.jsx';
import { AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS } from '../src/common/editor/ui/application-menu-registry.ts';

test('Tracks Resample follows the selected recording lock and refuses publication before writing PCM', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	let writes = 0;
	const beginSourceWrite: typeof store.beginSourceWrite = (...args) => { writes++; return store.beginSourceWrite(...args); };
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store: new Proxy(store, { get(target, key, receiver) {
			if (key === 'beginSourceWrite') return beginSourceWrite;
			const value: unknown = Reflect.get(target, key, receiver); return typeof value === 'function' ? value.bind(target) : value;
		} }), engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: .25, channelCount: 2, durationSeconds: .1, frequency: 440 });
	const trackId = controller.getSnapshot().selectedTrackId; assert.ok(trackId);
	const menu = () => {
		const snapshot = controller.getSnapshot(), project = controller.project; assert.ok(project);
		const menus = createApplicationMenus({ productId: 'soundscaper', aboutLabel: 'About', capabilities: snapshot.capabilities,
			locale: 'en', copy: ENGLISH_COPY, project, snapshot, blocked: false, editBlocked: false, showArmControls: true,
			selectionActive: false, selectedClip: null, durationFrames: 4800, effectsPanelOpen: false,
			projectBinEffectivelyOpen: false, uiFlags: {}, actionRuntime: null, actions: createMenuActionFixture() });
		const item = findMenuItem(menus, AUDIO_EDITOR_APPLICATION_MENU_ACTION_IDS.trackResample); assert.ok(item);
		const disabled: unknown = Reflect.get(item, 'disabled'); assert.equal(typeof disabled, 'boolean'); return disabled;
	};
	assert.equal(menu(), false);
	controller.actions.edit.commit({ type: 'track/update', trackId, changes: { locked: true } });
	const before = controller.project; assert.ok(before); writes = 0;
	assert.equal(menu(), true);
	await assert.rejects(controller.actions.track.resample(trackId, 24000), /locked/iu);
	assert.equal(writes, 0, 'a locked target never stages replacement audio');
	assert.deepEqual(controller.project?.sources, before.sources);
	assert.deepEqual(controller.project?.clips, before.clips);
	controller.actions.edit.commit({ type: 'track/update', trackId, changes: { locked: false } });
	assert.equal(menu(), false);
	await controller.actions.track.resample(trackId, 24000);
	const clip = controller.project?.clips[0]; assert.ok(clip);
	const source = controller.project?.sources.find(candidate => candidate.id === clip.sourceId); assert.ok(source?.kind === 'audio');
	assert.equal(source.sampleRate, 24000);
});

test('the Resample dialog follows its captured target lock while preserving its draft and Cancel', async () => {
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = environment.IS_REACT_ACT_ENVIRONMENT; environment.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	let calls = 0; const pending: Promise<unknown>[] = [];
	const controller = { actions: { track: { resample: () => { calls++; } } } };
	const render = (locked: boolean, selectedTrackId = 'target') => root.render(<EditorDialog type="resample" value="24000"
		onValueChange={() => undefined} trackId="target" controller={controller}
		snapshot={{ project: { id: 'project', sampleRate: 48000, tracks: [
			{ id: 'target', type: 'audio', locked }, { id: 'other', type: 'audio', locked: false },
		] }, selectedTrackId }} copy={ENGLISH_COPY} locale="en" run={(operation: () => unknown) => {
			const promise = Promise.resolve(operation()); pending.push(promise); return promise;
		}} onClose={() => undefined} />);
	const button = (label: string) => {
		const result = dom.container.querySelectorAll('button').find(candidate => candidate.textContent === label); assert.ok(result); return result;
	};
	try {
		await act(async () => { render(false); });
		await act(async () => { render(true, 'other'); });
		assert.equal(button(ENGLISH_COPY.resample).hasAttribute('disabled'), true);
		assert.equal(button(ENGLISH_COPY.cancel).hasAttribute('disabled'), false);
		await act(async () => { reactProps(dom.one('form')).onSubmit({ preventDefault() {} }); await Promise.all(pending); });
		assert.equal(calls, 0);
		await act(async () => { render(false, 'other'); });
		assert.equal(button(ENGLISH_COPY.resample).hasAttribute('disabled'), false);
		await act(async () => { reactProps(button(ENGLISH_COPY.resample)).onClick(); await Promise.all(pending); });
		assert.equal(calls, 1);
	} finally {
		await act(async () => { root.unmount(); }); environment.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React'); dom.restore();
	}
});
