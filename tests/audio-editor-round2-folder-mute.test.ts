/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import { planMuteAllTracks } from '../src/common/editor/controller/track-audio/internal/track-mute-all-plan.ts';
import { createDocumentTrackFolderSnapshot } from '../src/common/editor/controller/document/document-track-folder-snapshot.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { TrackListView } from '../src/common/editor/ui/timeline/TrackListView.jsx';
import { createTimelineProjectIndex } from '../src/common/editor/design-system-adapters/timeline.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createAudacityActionRuntime } from '../src/common/editor/audacity-action-runtime.js';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createMenuActionFixture, findMenuItem } from './helpers/application-menu-fixture.ts';
import { selectionControllerCustody, selectionWav } from './helpers/selection-controller-custody.tsx';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { reactProps } from './helpers/react-test-dom.ts';

test('global mute plans include folder authority and skip labels and unchanged controls', () => {
	const project = { tracks: [{ id: 'audio', type: 'audio', mute: false },
		{ id: 'label', type: 'label', mute: false }, { id: 'video', type: 'video', mute: true, hidden: true }],
		trackFolders: [{ id: 'parent', mute: true }, { id: 'child', mute: false }] };
	assert.deepEqual(planMuteAllTracks(project, false), [
		{ type: 'track/update', trackId: 'video', changes: { hidden: false } },
		{ type: 'track-folder/update', folderId: 'parent', changes: { mute: false } },
	]);
	assert.deepEqual(planMuteAllTracks(project, true), [
		{ type: 'track/update', trackId: 'audio', changes: { mute: true } },
		{ type: 'track-folder/update', folderId: 'child', changes: { mute: true } },
	]);
});

test('Unmute all restores a muted folder with one Undo and Redo', async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		store: createProjectStore({ indexedDB: null, preferOpfs: false }),
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: 0.4, channelCount: 1,
		durationSeconds: 0.8, frequency: 440 });
	const trackId = controller.getSnapshot().selectedTrackId!;
	const folderId = controller.actions.trackFolders.wrapSelection([trackId])!;
	controller.actions.trackFolders.update(folderId, { mute: true });
	controller.actions.track.unmuteAll();
	const muted = () => {
		const folder = createDocumentTrackFolderSnapshot(controller.getSnapshot().project).sequences[0]!.rows
			.find(row => row.id === folderId)!;
		assert.equal(folder.kind, 'folder');
		return folder.kind === 'folder' ? folder.mute : null;
	};
	assert.equal(muted(), false);
	controller.actions.edit.undo();
	assert.equal(muted(), true);
	controller.actions.edit.redo();
	assert.equal(muted(), false);
});

test('original stereo import reaches the actual folder mute row and global Unmute menu with complete PCM/history/Scape custody', async context => {
	const input = selectionWav('browser-tone-a.wav', 38_400, 2, 48_000, 330);
	const session = await selectionControllerCustody(context, input), { controller, fixture } = session;
	// Host the real row tree without running a native waveform raster loop; no pixels are asserted here.
	Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: () => 1 });
	Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: () => undefined });
	const parity = createAudacityActionRuntime(controller); context.after(() => parity.dispose());
	const empty = clipboardProject(controller.project).tracks.find(track => track.id === 'empty'); assert.ok(empty);
	assert.deepEqual(empty.clipIds, []); controller.actions.track.remove(empty.id);
	const original = clipboardProject(controller.project), clip = original.clips[0]; assert.ok(clip);
	assert.equal(original.tracks.length, 1); assert.equal(original.sources.length, 1);
	const source = original.sources[0]; assert.ok(source && source.kind === 'audio');
	assert.deepEqual([source.sampleRate, source.channelCount, source.frameCount], [48_000, 2, 38_400]);
	controller.actions.timeline.selectClip(clip.id);
	const track = original.tracks[0]; assert.ok(track);
	const folderId = controller.actions.trackFolders.wrapSelection([track.id]); assert.ok(folderId);
	const wrapped = clipboardProject(controller.project), entries = controller.getSnapshot().history.undoEntries.length;
	const noop = () => undefined;
	function FolderTracks() {
		const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
		const project = projectForRuntimeConsumers(clipboardProject(snapshot.project));
		return React.createElement(TrackListView, { project, controller, snapshot, projectIndex: createTimelineProjectIndex(project),
			visualTrackHeight: () => 80, documentSelection: project.selection, timeSelection: null, selectedTrackIds: new Set(),
			minHeight: 0, selectedClipIdSet: new Set(), draggingClipIds: null, clipDragPreview: null, projectBinDragPreview: null,
			mutationsBlocked: false, locale: 'en', copy: ENGLISH_COPY, run: fixture.run, setTrackMenu: noop, openClipMenu: noop,
			openTrackRulerFlyout: noop, onOpenEffects: noop, onOpenClipProperties: noop, focusTimelineRuler: noop, focusTrackContainer: noop,
			focusTrackPanelControl: noop, focusTrackClip: noop, focusTrackRuler: noop, focusSelectionToolbar: noop,
			isFlatNavigation: false, trackBaseTabIndex: 0, panelWidth: 240, timelineWidth: 600, verticalRulerWidth: 30,
			pixelsPerSecond: 100, sampleRate: 48_000, renderViewportStartFrame: 0, viewportDurationFrames: 48_000,
			waveformRulerState: {}, updateWaveformRuler: noop, recordingPreviews: [], waveformCache: new Map(), automationToolEnabled: false,
			automationRuntime: undefined, automationControls: null, spectralBrushEnabled: false, showArmControls: false, displayAudioSupported: false });
	}
	try {
		await fixture.render(React.createElement(FolderTracks));
		const mute = fixture.dom.one('[aria-label="Mute folder"]'); assert.equal(mute.getAttribute('aria-pressed'), 'false');
		await act(async () => { reactProps(mute).onClick({ stopPropagation() {} }); await fixture.settle(); });
		assert.equal(mute.getAttribute('aria-pressed'), 'true');
		const muted = { ...clipboardDocument(wrapped), trackFolders: wrapped.trackFolders.map(folder => ({ ...folder, mute: true })) };
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), muted);
		const snapshot = controller.getSnapshot(), project = projectForRuntimeConsumers(clipboardProject(snapshot.project));
		const menus = createApplicationMenus({ productId: 'soundscaper', aboutLabel: 'About Soundscaper', capabilities: snapshot.capabilities,
			locale: 'en', copy: ENGLISH_COPY, project, snapshot, blocked: false, editBlocked: false, showArmControls: false,
			selectionActive: false, selectedClip: project.clips[0], durationFrames: 38_400, effectsPanelOpen: false,
			projectBinEffectivelyOpen: false, uiFlags: {}, actionRuntime: parity.actions,
			actions: createMenuActionFixture({ installAvailable: () => false,
				selectionEffectMutationLocked: (type: string) => controller.actions.effects.readSelectionTargetLocked?.(type) === true }) });
		interface Menu { readonly id?: unknown; readonly items?: readonly Menu[]; readonly disabled?: unknown; readonly onClick?: unknown }
		const item = findMenuItem<Menu>(menus, 'unmute-all'); assert.ok(item); assert.notEqual(item.disabled, true);
		const click = item.onClick; assert.ok(typeof click === 'function');
		await act(async () => { await click(); });
		assert.equal(mute.getAttribute('aria-pressed'), 'false');
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(wrapped));
		assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 2);
		await act(async () => { controller.actions.edit.undo(); }); assert.equal(mute.getAttribute('aria-pressed'), 'true');
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), muted);
		await act(async () => { controller.actions.edit.redo(); }); assert.equal(mute.getAttribute('aria-pressed'), 'false');
		assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(wrapped));
		await act(async () => { await session.archive(); });
	} finally { await session.dispose(); }
});
