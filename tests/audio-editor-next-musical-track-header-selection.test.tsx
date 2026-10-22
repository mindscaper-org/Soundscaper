/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TrackControls } from '../src/common/editor/ui/timeline/TrackControls.jsx';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('NP015: the timeline track-panel double click selects authored musical clip boundaries', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write([new Float32Array(48_000)]); await writer.commit();
	const initial = createSoundscaperProject({ sources: [source], clips: [createAudioClip({ id: 'music', sourceId: source.id,
		anchor: 'musical', musicalStartBeat: { num: 4, den: 1 }, musicalExtent: 'beat', musicalDurationBeats: { num: 2, den: 1 }, sourceDurationFrames: 48_000 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['music'] })] });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: ENGLISH_COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	await controller.ready; await controller.actions.project.open(initial);
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorReact = globals.React, priorAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	context.after(async () => { await act(async () => root.unmount()); await controller.dispose(); dom.restore(); globals.React = priorReact; globals.IS_REACT_ACT_ENVIRONMENT = priorAct; });
	const track = controller.project?.tracks[0]; assert.ok(track);
	await act(async () => root.render(<TrackControls controller={controller} track={track}
		trackHeight={180} panelWidth={240} selected blocked={false} showArmControls={false} displayAudioSupported={false}
		recordingInputs={[]} automationTargets={[]} automationTarget={undefined} automationRuntime={undefined}
		isFlatNavigation={false} copy={ENGLISH_COPY} run={(operation: () => unknown) => operation()}
		onMenu={() => undefined} onOpenEffects={() => undefined} onAutomationTarget={() => undefined}
		onTabOut={() => undefined} onShiftTabOut={() => undefined} onNavigateVertical={() => undefined} />));
	const controls = dom.one('.audio-editor-track-controls');
	await act(async () => reactProps(controls).onClickCapture({ detail: 2, target: controls, preventDefault() {}, stopPropagation() {} }));
	assert.deepEqual([controller.project?.selection.startFrame, controller.project?.selection.endFrame], [96_000, 144_000]);
	assert.equal(controller.project?.clips[0]?.anchor, 'musical');
});
