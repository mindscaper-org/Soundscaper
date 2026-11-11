/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import { AccessibleSelectionToolbar } from '../src/common/editor/ui/toolbar/AudioEditorTransportControls.jsx';
import TransportToolbarGroup from '../src/common/editor/ui/toolbar/TransportToolbarGroup.jsx';
import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { createAudacityActionRuntime, createAudioEditorUiActionController } from '../src/common/editor/audacity-action-runtime.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { findMenuItem } from './helpers/application-menu-fixture.ts';
import { reactProps } from './helpers/react-test-dom.ts';
import { selectionWav } from './helpers/selection-controller-custody.tsx';
import { createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { assertAudioProjectArchivePcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { projectDurationFrames } from '../src/common/editor/project.js';
import { createTransportFixture } from './helpers/audio-editor-transport-fixture.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';

test('canonical loop command honors a cleared range while bare disable retains it', () => {
	const project = createSoundscaperProject({ id: 'clear-loop' });
	const stored = applySoundscaperProjectCommand(project, { type: 'loop/set', enabled: true, startFrame: 100, endFrame: 400 });
	const disabled = applySoundscaperProjectCommand(stored, { type: 'loop/set', enabled: false });
	assert.deepEqual(disabled.loop, { enabled: false, startFrame: 100, endFrame: 400 });
	const cleared = applySoundscaperProjectCommand(stored, { type: 'loop/set', enabled: false, startFrame: 0, endFrame: 0 });
	assert.deepEqual(cleared.loop, { enabled: false, startFrame: 0, endFrame: 0 });
	assert.deepEqual(stored.loop, { enabled: true, startFrame: 100, endFrame: 400 });
	assert.throws(() => applySoundscaperProjectCommand(stored, { type: 'loop/set', enabled: true, startFrame: 0, endFrame: 0 }), /positive duration/u);
});

for (const followsLoop of [false, true]) {
	test(`Clear loop removes the stored range without changing selection when follow is ${followsLoop}`, async () => {
		const fixture = createTransportFixture();
		fixture.state.selectionFollowsLoop = followsLoop;
		fixture.setProject({ ...fixture.project(),
			selection: { startFrame: 20, endFrame: 60, trackIds: ['track'], clipIds: [],
				frequencyRange: { minimumFrequency: 100, maximumFrequency: 1000 } },
			loop: { enabled: true, startFrame: 100, endFrame: 400 },
		});
		const original = structuredClone(fixture.project());
		assert.deepEqual(fixture.service.clearLoopRegion(), { enabled: false, startFrame: 0, endFrame: 0 });
		assert.deepEqual(fixture.project().selection, original.selection);
		assert.deepEqual(fixture.calls.loops, [{ enabled: false, startFrame: 0, endFrame: 0 }]);
		await fixture.service.handleTransport('loop');
		assert.deepEqual(fixture.project().loop, { enabled: true, startFrame: 20, endFrame: 60 });
		assert.deepEqual(original.loop, { enabled: true, startFrame: 100, endFrame: 400 });
	});
}

test('ordinary loop toggle preserves its disabled range for later reuse', async () => {
	const fixture = createTransportFixture();
	fixture.setProject({ ...fixture.project(), loop: { enabled: true, startFrame: 100, endFrame: 400 } });
	await fixture.service.handleTransport('loop');
	assert.deepEqual(fixture.project().loop, { enabled: false, startFrame: 100, endFrame: 400 });
	await fixture.service.handleTransport('loop');
	assert.deepEqual(fixture.project().loop, { enabled: true, startFrame: 100, endFrame: 400 });
});

function productionMenus(controller: Awaited<ReturnType<typeof controllerSession>>['controller'], fixture: ReturnType<typeof mountControllerDataDom>, parity: ReturnType<typeof createAudacityActionRuntime>) {
	const snapshot = controller.getSnapshot(), project = snapshot.project;
	const ui = parity.uiController.actions;
	const surface = (id: string) => ui.openSurface(id, {});
	const request = (type: string, value?: unknown) => ui.issue(type, { value });
	const panel = (id: string) => controller.actions.preferences.setPanelVisibility(id, true);
	return createWorkspaceApplicationMenus({
		aboutLabel: 'About Soundscaper', aup4InputRef: { current: null }, importInputRef: { current: null },
		blocked: false, editBlocked: false, handoffBlocked: false, capabilities: snapshot.capabilities, compactLayout: false,
		controller, copy: ENGLISH_COPY, crossProductHandoffAvailable: false, desktopHostRuntime: null,
		durationFrames: projectDurationFrames(project), fileService: { isDesktop: false }, locale: 'en', parityRuntime: parity, productId: 'soundscaper', project,
		projectBinEffectivelyOpen: true, recordLabel: ENGLISH_COPY.record, run: fixture.run, selectedClip: null, selectedAudioTrack: null,
		selectionActive: Boolean(snapshot.selection && snapshot.selection.endFrame > snapshot.selection.startFrame), showArmControls: false, snapshot, soundscaperWorkflow: undefined,
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


interface MenuEntry { readonly id?: unknown; readonly items?: readonly MenuEntry[]; readonly disabled?: unknown; readonly onClick?: unknown }
type Controller = Awaited<ReturnType<typeof controllerSession>>['controller'];
type Dom = ReturnType<typeof mountControllerDataDom>;
function Controls({ controller, fixture }: Readonly<{ controller: Controller; fixture: Dom }>) {
	const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	return React.createElement(React.Fragment, null,
		React.createElement(AccessibleSelectionToolbar, { controller, snapshot, copy: ENGLISH_COPY, statusMessage: 'Ready',
			statusState: 'success', durationFrames: 38400, disabled: false, showSelectionToolbar: true, showStatusbar: true, run: fixture.run }),
		React.createElement(TransportToolbarGroup, { buttons: ['loop'], blocked: false, capabilities: snapshot.capabilities,
			controller, copy: ENGLISH_COPY, locale: 'en', run: fixture.run, snapshot, toolbarButtons: { loop: true },
			onJumpToStart: () => controller.actions.transport.seek(0), onJumpToEnd: () => controller.actions.transport.seek(projectDurationFrames(snapshot.project)),
			onOpenTakeCycleRecovery: () => assert.fail('Loop controls must not open recording recovery.'),
			onOpenTimedRecording: () => assert.fail('Loop controls must not open recording setup.'),
			recordLabel: ENGLISH_COPY.record, toggleRecording: () => assert.fail('Loop controls must not record.') }));
}

test('actual loop menu and subscribed controls clear boundaries before using a new range through history and Scape', { timeout: 20_000 }, async context => {
	type Options = NonNullable<Parameters<typeof controllerSession>[1]>;
	const input = selectionWav('browser-tone-a.wav', 38400, 2, 48000, 330);
	let nativeAccesses = 0;
	const forbidden = () => { nativeAccesses++; assert.fail('Loop commands must not decode, allocate or render native audio.'); };
	const { controller, store } = await controllerSession(context, { engineFactory: forbidden,
		engine: { ...createMemoryEngine(), decodeAudioData: async () => forbidden(), getAudioContext: async () => forbidden() } as unknown as Options['engine'] });
	await controller.actions.project.importFiles([input.file]);
	const original = clipboardProject(controller.project), clip = original.clips[0]; assert.ok(clip?.kind === 'audio');
	const track = original.tracks.find(row => Array.isArray(row.clipIds) && row.clipIds.includes(clip.id)); assert.ok(track);
	const fixture = mountControllerDataDom(), uiController = createAudioEditorUiActionController();
	const parity = createAudacityActionRuntime(controller, { uiController, productId: 'soundscaper', locale: 'en', copy: ENGLISH_COPY });
	const observer = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	try {
		await fixture.render(React.createElement(Controls, { controller, fixture }));
		const invoke = async (id: string) => {
			const entry = findMenuItem<MenuEntry>(productionMenus(controller, fixture, parity), id); assert.ok(entry && !entry.disabled, id);
			const click = entry.onClick; assert.ok(typeof click === 'function');
			await act(async () => { click(); await fixture.settle(); });
		};
		const pressed = () => fixture.dom.one('[aria-label="Loop selection"]').getAttribute('aria-pressed');
		await act(async () => { controller.actions.timeline.setExactSelection(9600, 19200, { trackIds: [track.id] }); });
		const selection = structuredClone(controller.project?.selection), entries = controller.getSnapshot().history.undoEntries.length;
		await invoke('set-loop-region-to-selection');
		const stored = clipboardProject(controller.project); assert.deepEqual(stored.loop, { enabled: true, startFrame: 9600, endFrame: 19200 });
		assert.equal(pressed(), 'true');
		await invoke('clear-loop-region');
		const cleared = clipboardProject(controller.project);
		assert.deepEqual(cleared.loop, { enabled: false, startFrame: 0, endFrame: 0 });
		assert.deepEqual(cleared.selection, selection); assert.equal(pressed(), 'false');
		assert.deepEqual(clipboardDocument(cleared), { ...clipboardDocument(stored), loop: { enabled: false, startFrame: 0, endFrame: 0 } });
		assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 2);
		await act(async () => { controller.actions.edit.undo(); }); assert.equal(pressed(), 'true');
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(stored));
		await act(async () => { controller.actions.edit.redo(); }); assert.equal(pressed(), 'false');
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(cleared));
		await act(async () => { controller.actions.timeline.setExactSelection(19200, 28800, { trackIds: [track.id] }); });
		const range = () => fixture.dom.one('[data-selection-toolbar]').querySelectorAll('.timecode__display').slice(0, 2).map(node => node.textContent);
		const clocks = range(); assert.deepEqual(clocks, ['00h00m00.400s', '00h00m00.600s']);
		await act(async () => { reactProps(fixture.dom.one('[aria-label="Loop selection"]')).onClick(); await fixture.settle(); });
		assert.equal(pressed(), 'true'); assert.deepEqual(controller.project?.loop, { enabled: true, startFrame: 19200, endFrame: 28800 });
		await invoke('set-selection-to-loop'); assert.deepEqual(range(), clocks);
		const final = clipboardProject(controller.project);
		assert.deepEqual(final.sources, original.sources); assert.deepEqual(final.clips, original.clips); assert.deepEqual(final.tracks, original.tracks);
		await act(async () => { await controller.actions.project.flush({ forceCurrentSnapshot: true }); });
		const reopened = await assertAudioProjectArchivePcm(context, store, controller.project, (name, channels) => {
			assert.equal(name, input.file.name); assertPcmChannelsEqual(channels, input.pcm, 'all original toneA RIFF16 samples');
		});
		assert.deepEqual(clipboardDocument(reopened), clipboardDocument(final)); assert.equal(nativeAccesses, 0);
	} finally {
		await fixture.dispose(); parity.dispose(); uiController.dispose();
		if (observer) Object.defineProperty(globalThis, 'MutationObserver', observer); else Reflect.deleteProperty(globalThis, 'MutationObserver');
	}
});
