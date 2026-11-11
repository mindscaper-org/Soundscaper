/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createClipSelectionNavigationService, type ClipSelectionNavigationProject } from '../src/common/editor/controller/track-audio/internal/clip-selection-navigation-service.ts';
import { createWorkspaceSelectionViewMenuPorts } from '../src/common/editor/ui/workspace/selection-view-menu-ports.ts';
import { SequenceTimingControls } from '../src/common/editor/ui/toolbar/SequenceTimingControls.jsx';
import { createAudacityActionRuntime, createAudioEditorUiActionController } from '../src/common/editor/audacity-action-runtime.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { normalizeVideoGeneratorClipV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';

test('the published Skip actions resolve selected native Title geometry without a drawn range', async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const controller = createFramescaperAudioEditorController(environment);
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready;
	const authoring = framescaperCandidateAuthoringActionRuntimeFor(controller);
	assert.ok(authoring);
	await authoring.run('video-title');
	const clip = controller.project?.clips.find(candidate => (candidate as Readonly<Record<string, unknown>>).kind === 'generator');
	assert.ok(clip);
	const clipId = String(clip.id);
	const original = normalizeVideoGeneratorClipV1(clip);
	assert.deepEqual([original.sequenceStartFrame, original.sequenceFrameCount, original.sourceInFrame, original.sourceFrameCount], [0, 150, 0, 150]);
	const fixture = mountControllerDataDom();
	const uiController = createAudioEditorUiActionController();
	const parity = createAudacityActionRuntime(controller, { uiController, productId: 'framescaper', locale: 'en', copy: ENGLISH_COPY });
	const menuController = { actions: { ...controller.actions, timeline: { ...controller.actions.timeline,
		zoomFit: () => controller.actions.timeline.zoomFit(controller.getSnapshot().timeline.viewportWidth),
	} } };
	const rawView: unknown = Reflect.get(controller.getSnapshot().preferences, 'view');
	const viewFlag = (name: string) => {
		if (rawView === undefined) return undefined;
		assert.ok(rawView && typeof rawView === 'object');
		const value: unknown = Reflect.get(rawView, name); assert.ok(value === undefined || typeof value === 'boolean'); return value;
	};
	const menus = createWorkspaceSelectionViewMenuPorts({ controller: menuController, parityRuntime: parity,
		snapshot: { preferences: { view: { showFadeShapeHandles: viewFlag('showFadeShapeHandles'), showMarkers: viewFlag('showMarkers') } } }, run: fixture.run,
		zoomProject: () => assert.fail('Selection navigation must not zoom.'),
		setShowArmControls: () => assert.fail('Selection navigation must not change recording controls.'),
		toggleWorkspacePanel: () => assert.fail('Selection navigation must not change workspace panels.'),
		openSurface: () => assert.fail('Selection navigation must not open a surface.'),
	});
	function Clock() {
		const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
		return React.createElement(SequenceTimingControls, { project: snapshot.project, snapshot, controller, copy: ENGLISH_COPY, run: fixture.run });
	}
	try {
		await fixture.render(React.createElement(Clock));
		await act(async () => { controller.actions.timeline.selectClip(clipId); await menus.selectionMenu.selectTrackStartToEnd(); });
		assert.deepEqual([controller.project?.selection.startFrame, controller.project?.selection.endFrame], [0, 240_000]);
		await act(async () => { await menus.selectionMenu.skipToSelectionEnd(); });
		assert.equal(controller.getTelemetrySnapshot().positionFrame, 240_000);
		assert.equal(fixture.dom.one('[data-sequence-timecode]').getAttribute('data-sequence-timecode'), '00:00:05:00');
		await act(async () => { await menus.selectionMenu.selectNone(); controller.actions.transport.seek(0); });
		assert.equal(fixture.dom.one('[data-sequence-timecode]').getAttribute('data-sequence-timecode'), '00:00:00:00');
		await act(async () => { controller.actions.timeline.selectClip(clipId); });
		assert.equal(controller.project?.selection.startFrame, controller.project?.selection.endFrame);
		assert.deepEqual(controller.project?.selection.clipIds, [clipId]);
		await act(async () => { await controller.actions.project.flush({ forceCurrentSnapshot: true }); });
		const beforeSeek = structuredClone(controller.project), beforeHistory = structuredClone(controller.getSnapshot().history);
		assert.ok(beforeSeek);
		assert.deepEqual(await environment.store.loadProject(beforeSeek.id), beforeSeek);
		await act(async () => { await menus.selectionMenu.skipToSelectionEnd(); });
		assert.equal(controller.getTelemetrySnapshot().positionFrame, 240_000);
		assert.equal(fixture.dom.one('[data-sequence-timecode]').getAttribute('data-sequence-timecode'), '00:00:05:00');
		assert.deepEqual(controller.project, beforeSeek); assert.deepEqual(controller.getSnapshot().history, beforeHistory);
		assert.deepEqual(await environment.store.loadProject(beforeSeek.id), beforeSeek, 'transient seek does not rewrite the native document');
	} finally { await fixture.dispose(); parity.dispose(); uiController.dispose(); }
	controller.actions.clip.move(clipId, null, 48_000);
	controller.actions.timeline.selectClip(clipId);
	controller.actions.timeline.selectTrackStartToEnd();
	assert.equal(controller.actions.timeline.skipToSelectionStart(), 48_000);
	assert.equal(controller.actions.timeline.skipToSelectionEnd(), 288_000);
	controller.actions.timeline.clearSelection();
	controller.actions.transport.seek(0);
	controller.actions.timeline.selectClip(clipId);
	assert.equal(controller.project?.selection.startFrame, controller.project?.selection.endFrame);
	assert.deepEqual(controller.project?.selection.clipIds, [clipId]);
	const authored = structuredClone(controller.project);
	const history = controller.getSnapshot().history;
	assert.equal(controller.actions.timeline.skipToSelectionStart(), 48_000);
	assert.equal(controller.getTelemetrySnapshot().positionFrame, 48_000);
	assert.equal(controller.actions.timeline.skipToSelectionEnd(), 288_000);
	assert.equal(controller.getTelemetrySnapshot().positionFrame, 288_000);
	assert.deepEqual(controller.project, authored);
	assert.deepEqual(controller.getSnapshot().history, history);
});

test('Skip resolves disjoint native visual edges on their absolute NTSC grid', () => {
	for (const kind of ['image', 'still', 'generator', 'video']) {
		const project: ClipSelectionNavigationProject = {
			sampleRate: 48_000, primarySequenceId: 'main',
			sequences: [{ id: 'main', rate: { num: 30_000, den: 1001 } }],
			clips: [{ id: 'first', kind, sequenceId: 'main', sequenceStartFrame: 3, sequenceFrameCount: 3 },
				{ id: 'last', kind, sequenceId: 'main', sequenceStartFrame: 30, sequenceFrameCount: 3 }],
			tracks: [{ id: 'pictures', type: 'video', clipIds: ['first', 'last'] }],
			selection: { startFrame: 0, endFrame: 0, clipIds: ['first', 'last'] },
		};
		const seeks: number[] = [];
		const service = createClipSelectionNavigationService({ getProject: () => project,
			state: { selectedClipId: 'first', selectedTrackId: 'pictures', selectedAnnotationId: null },
			updateSelection: () => assert.fail('Skip must not publish a selection'),
			seek: frame => { seeks.push(frame); } });
		assert.equal(service.skipToSelectionStart(), 4805, kind);
		assert.equal(service.skipToSelectionEnd(), 52_853, kind);
		assert.deepEqual(seeks, [4805, 52_853]);
	}
});

test('Skip honors a selected musical clip rather than its stale sample cache', () => {
	const project: ClipSelectionNavigationProject = { sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
		clips: [{ id: 'music', kind: 'audio', anchor: 'musical', musicalStartBeat: { num: 2, den: 1 },
			musicalExtent: 'beat', musicalDurationBeats: { num: 1, den: 1 }, sourceStartFrame: 0,
			sourceDurationFrames: 48_000, timelineStartFrame: 7, durationFrames: 11 }],
		tracks: [{ id: 'sound', type: 'audio', clipIds: ['music'] }],
		selection: { startFrame: 0, endFrame: 0, clipIds: ['music'] } };
	const service = createClipSelectionNavigationService({ getProject: () => project,
		state: { selectedClipId: 'music', selectedTrackId: 'sound', selectedAnnotationId: null },
		updateSelection: () => assert.fail('Skip must not publish a selection'), seek: () => {} });
	assert.equal(service.skipToSelectionStart(), 48_000);
	assert.equal(service.skipToSelectionEnd(), 72_000);
});
