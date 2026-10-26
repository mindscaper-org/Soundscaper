/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { LabelTrackRow } from '../src/common/editor/ui/timeline/LabelTrackRow.jsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

test('a same-ID native File Open Replace retires the inline label title draft', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const previousSelect = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'select');
	Object.defineProperty(ReactTestElement.prototype, 'select', { configurable: true, value() {} });
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'inline-label-generation' });
	await store.saveProject(createSoundscaperProject({ id: 'same-project', tracks: [{ id: 'labels', type: 'label',
		name: 'Labels', labels: [{ id: 'intro', title: 'Original', startFrame: 0, endFrame: 48_000 }] }] }));
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		scapeProjectRuntime: createSoundscaperScapeNativeRuntime(), projectRuntime,
		sessionController: projectRuntime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	const render = () => {
		const track = controller.project?.tracks.find(candidate => candidate.id === 'labels'); assert.ok(track);
		root.render(<LabelTrackRow controller={controller} track={track} visualHeight={100} trackIndex={0}
			panelWidth={180} timelineWidth={600} verticalRulerWidth={40} pixelsPerSecond={100}
			sampleRate={48_000} viewportDurationFrames={96_000} timeSelection={null} rangeSelected={false}
			selected blocked={false} copy={COPY} run={(operation: () => unknown) => operation()} onMenu={() => undefined} />);
	};
	try {
		await controller.ready;
		await controller.actions.project.openById('same-project');
		const saved = await store.loadProject('same-project'); assert.ok(saved);
		const archive = await exportScapeProject(saved, store); assert.ok(archive.blob instanceof Blob);
		await act(async () => { render(); });
		const marker = dom.one('[data-label-id="intro"]');
		await act(async () => { reactProps(marker).onDoubleClick({ stopPropagation() {} }); });
		const input = dom.one('.audio-editor-label-title-input');
		input.value = 'Abandoned inline draft';
		await controller.actions.timeline.setExactSelection(12, 24);
		await act(async () => { render(); });
		assert.equal(dom.one('.audio-editor-label-title-input').value, 'Abandoned inline draft', 'ordinary publications retain editing');
		await controller.actions.project.openScapeFile(new File([archive.blob], 'Replacement.sscape'), () => 'replace');
		await act(async () => { render(); });
		const remaining = dom.find('.audio-editor-label-title-input');
		if (remaining) await act(async () => { reactProps(remaining).onBlur({ currentTarget: remaining }); });
		const track = controller.project?.tracks.find(candidate => candidate.id === 'labels'); assert.ok(track);
		const labels: unknown = Reflect.get(track, 'labels'); assert.ok(Array.isArray(labels));
		const label: unknown = labels[0]; assert.ok(label && typeof label === 'object' && 'title' in label);
		assert.equal(label.title, 'Original', 'the replacement must not receive the earlier activation draft');
		assert.equal(dom.find('.audio-editor-label-title-input'), null);
	} finally {
		await act(async () => { root.unmount(); });
		if (previousSelect) Object.defineProperty(ReactTestElement.prototype, 'select', previousSelect);
		else Reflect.deleteProperty(ReactTestElement.prototype, 'select');
		dom.restore(); globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
