/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TrackListView } from '../src/common/editor/ui/timeline/TrackListView.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('NP017: opening a native project retires an uncontrolled outgoing folder-name input', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: ENGLISH_COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store, scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	await controller.ready;
	const project = (id: string) => createSoundscaperProject({ id, title: id, trackFolders: [{ id: 'folder', name: 'Folder' }],
		sequences: [{ id: 'main', trackNodes: [{ kind: 'folder', id: 'folder', parentFolderId: null }] }], primarySequenceId: 'main' });
	await controller.actions.project.open(project('outgoing'));
	const archive = await exportScapeProject(project('incoming'), store); const blob = archive.blob; assert.ok(blob instanceof Blob);
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorReact = globals.React, priorAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	context.after(async () => { await act(async () => root.unmount()); await controller.dispose(); dom.restore(); globals.React = priorReact; globals.IS_REACT_ACT_ENVIRONMENT = priorAct; });
	const noop = () => undefined;
	const render = () => { const snapshot = controller.getSnapshot(), current = snapshot.project; assert.ok(current);
		root.render(<TrackListView project={current} controller={controller} snapshot={snapshot}
			projectIndex={{ clipsByTrackId: new Map(), clipById: new Map(), sourceById: new Map() }} visualTrackHeight={() => 80}
			documentSelection={current.selection} timeSelection={null} selectedTrackIds={new Set()} minHeight={0} selectedClipIdSet={new Set()}
			draggingClipIds={null} clipDragPreview={null} projectBinDragPreview={null} mutationsBlocked={false} locale="en" copy={ENGLISH_COPY}
			run={(operation: () => unknown) => operation()} setTrackMenu={noop} openClipMenu={noop} openTrackRulerFlyout={noop}
			onOpenEffects={noop} onOpenClipProperties={noop} focusTimelineRuler={noop} focusTrackContainer={noop} focusTrackPanelControl={noop}
			focusTrackClip={noop} focusTrackRuler={noop} focusSelectionToolbar={noop} isFlatNavigation={false} trackBaseTabIndex={0}
			panelWidth={240} timelineWidth={600} verticalRulerWidth={30} pixelsPerSecond={100} sampleRate={48_000} renderViewportStartFrame={0}
			viewportDurationFrames={48_000} waveformRulerState={{}} updateWaveformRuler={noop} recordingPreviews={[]} waveformCache={new Map()}
			automationToolEnabled={false} automationRuntime={undefined} automationControls={null} spectralBrushEnabled={false}
			showArmControls={false} displayAudioSupported={false} />); };
	await act(async () => render());
	await act(async () => reactProps(dom.one('[data-track-folder-row]')).onKeyDown({ key: 'F2', preventDefault() {}, stopPropagation() {} }));
	dom.one('input').value = 'Outgoing folder draft';
	await controller.actions.project.rename('Keep same-project rename'); await act(async () => render());
	assert.equal(dom.one('input').value, 'Outgoing folder draft');
	await act(async () => { await controller.actions.project.openScapeFile(new File([blob], 'Incoming.sscape'), () => 'copy'); render(); });
	const input = dom.find('input');
	if (input) await act(async () => reactProps(input).onBlur({ currentTarget: input }));
	assert.equal(controller.project?.trackFolders[0]?.name, 'Folder');
	assert.equal(dom.find('input'), null, 'the outgoing editor must retire on activation');
});
