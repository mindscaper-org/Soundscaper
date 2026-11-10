/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import WorkspacePreferencesDialog from '../src/common/editor/ui/dialogs/WorkspacePreferencesDialog.jsx';
import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { createAudacityActionRuntime, createAudioEditorUiActionController } from '../src/common/editor/audacity-action-runtime.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { reactProps } from './helpers/react-test-dom.ts';

type Controller = Awaited<ReturnType<typeof controllerSession>>['controller'];
type Dom = ReturnType<typeof mountControllerDataDom>;
type Parity = ReturnType<typeof createAudacityActionRuntime>;

/** The browser's complete menu factory and real action tree; UI requests use its production UI controller. */
function productionMenus(controller: Controller, fixture: Dom, parity: Parity) {
	const snapshot = controller.getSnapshot(), project = snapshot.project;
	const ui = parity.uiController.actions;
	const surface = (id: string) => ui.openSurface(id, {});
	const request = (type: string, value?: unknown) => ui.issue(type, { value });
	const panel = (id: string) => controller.actions.preferences.setPanelVisibility(id, true);
	return createWorkspaceApplicationMenus({
		aboutLabel: 'About Soundscaper', aup4InputRef: { current: null }, importInputRef: { current: null },
		blocked: false, editBlocked: false, handoffBlocked: false, capabilities: snapshot.capabilities, compactLayout: false,
		controller, copy: ENGLISH_COPY, crossProductHandoffAvailable: false, desktopHostRuntime: null,
		durationFrames: 0, fileService: { isDesktop: false }, locale: 'en', parityRuntime: parity, productId: 'soundscaper', project,
		projectBinEffectivelyOpen: true, recordLabel: ENGLISH_COPY.record, run: fixture.run, selectedClip: null, selectedAudioTrack: null,
		selectionActive: false, showArmControls: false, snapshot, soundscaperWorkflow: undefined,
		uiFlags: parity.uiController.getSnapshot().flags,
		executeEdit: (id: string) => {
			const operation: unknown = Reflect.get(controller.actions.edit, id); assert.ok(typeof operation === 'function');
			return Reflect.apply(operation, controller.actions.edit, []);
		},
		openDesktopFiles: () => request('open-files'), openProjectFile: undefined,
		openEffects: () => surface('effects'), openAssistanceSearch: undefined, openExternal: (url: string) => ui.openExternal(url),
		openGenerator: (type: string) => ui.openSurface('generator', { type }), openProjects: () => surface('projects'),
		openSelectionEffect: (type: string) => ui.openSurface('selection-effect', { type }),
		openSpectralSelection: () => surface('spectral-selection'), openSurface: surface,
		openTimedRecording: () => surface('timed-recording'), openTrackRate: () => surface('track-rate'), openWorkspacePanel: panel,
		setDialog: surface, setDialogValue: (value: unknown) => request('dialog-value', value),
		setNyquistTarget: (value: unknown) => request('nyquist-target', value),
		setShowArmControls: (value: unknown) => request('arm-controls', value),
		toggleFullscreen: () => request('fullscreen'), toggleRecording: () => request('record'),
		toggleWorkspacePanel: (id: string) => request('toggle-workspace-panel', id),
		zoomProject: (direction: string) => direction === 'in' ? controller.actions.timeline.zoomIn() : controller.actions.timeline.zoomOut(),
	});
}

function Preferences({ controller, fixture, parity }: Readonly<{ controller: Controller; fixture: Dom; parity: Parity }>) {
	const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	return <WorkspacePreferencesDialog controller={controller} snapshot={snapshot} copy={ENGLISH_COPY} locale="en"
		menus={productionMenus(controller, fixture, parity)} run={fixture.run} initialPage="shortcuts" productId="soundscaper"
		fileService={{ isDesktop: false }} onClose={() => undefined} onTogglePanel={(id: string) => controller.actions.preferences.setPanelVisibility(id, true)} />;
}

test('the actual full menu/controller inventory exposes implemented shortcut rows in mounted preferences', async context => {
	const { controller, store } = await controllerSession(context, {
		engineFactory: () => { throw new Error('Shortcut inventory must not render audio.'); },
	});
	await controller.actions.project.flush();
	const project = structuredClone(controller.project), history = structuredClone(controller.getSnapshot().history);
	const preferences = structuredClone(controller.getSnapshot().preferences);
	const stored = await store.loadSetting('soundscaper:audio-editor-preferences-v1');
	const uiController = createAudioEditorUiActionController();
	const parity = createAudacityActionRuntime(controller, { uiController, productId: 'soundscaper', locale: 'en', copy: ENGLISH_COPY });
	const fixture = mountControllerDataDom();
	const priorObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	try {
		await fixture.render(<Preferences controller={controller} fixture={fixture} parity={parity} />);
		const search = fixture.dom.one('[aria-label="Search commands"]');
		const query = async (value: string) => { await act(async () => { reactProps(search).onChange({ currentTarget: { value } }); }); };
		await query('Insert');
		const insert = fixture.dom.one('[data-shortcut-action="insert"]');
		assert.notEqual(insert.getAttribute('aria-disabled'), 'true');
		const field = insert.querySelector('input'); assert.ok(field); assert.equal(field.getAttribute('disabled'), null);
		await act(async () => { reactProps(field).onChange({ currentTarget: { value: 'Alt+U' } }); });
		const assign = insert.querySelectorAll('button').find(node => node.textContent === 'Assign'); assert.ok(assign);
		assert.equal(assign.getAttribute('disabled'), null);
		assert.equal(insert.querySelectorAll('[data-shortcut-disabled-reason]').length, 0);
		await query('Zoom normal'); assert.ok(fixture.dom.find('[data-shortcut-action="zoom-default"]'));
		await query('');
		assert.equal(fixture.dom.find('[data-shortcut-action="plugin-manager"]'), null);
		await query('Nyquist prompt'); assert.ok(fixture.dom.find('[data-shortcut-action="nyquist-prompt"]'));
		assert.deepEqual(controller.getSnapshot().preferences, preferences, 'editing a candidate chord must not assign it');
		assert.deepEqual(await store.loadSetting('soundscaper:audio-editor-preferences-v1'), stored);
		assert.deepEqual(controller.project, project); assert.deepEqual(controller.getSnapshot().history, history);
	} finally {
		await fixture.dispose(); parity.dispose(); uiController.dispose();
		if (priorObserver) Object.defineProperty(globalThis, 'MutationObserver', priorObserver); else Reflect.deleteProperty(globalThis, 'MutationObserver');
	}
});
