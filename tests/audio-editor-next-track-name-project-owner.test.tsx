/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TrackNameEditor } from '../src/common/editor/ui/timeline/TrackControls.jsx';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

test('NP013: File Open retires an unfinished track name even when track identity and name match', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', productId: 'soundscaper', copy: COPY,
		store, projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	await controller.ready;
	const project = (id: string) => createSoundscaperProject({ id, title: id, tracks: [createAudioTrack({ id: 'voice', name: 'Voice' })] });
	await controller.actions.project.open(project('outgoing'));
	const archive = await exportScapeProject(project('incoming'), store); const archiveBlob = archive.blob; assert.ok(archiveBlob instanceof Blob);
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React'); Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }; const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const priorSelect = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'select');
	Object.defineProperty(ReactTestElement.prototype, 'select', { configurable: true, value() {} });
	let closed = 0;
	context.after(async () => { await act(async () => root.unmount()); await controller.dispose(); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		if (priorSelect) Object.defineProperty(ReactTestElement.prototype, 'select', priorSelect); else Reflect.deleteProperty(ReactTestElement.prototype, 'select'); dom.restore(); });
	const render = () => { const track = controller.project?.tracks[0]; assert.ok(track);
		root.render(<TrackNameEditor track={track} label="Track name" blocked={false} controller={controller}
			run={(operation: () => unknown) => operation()} onClose={() => { closed += 1; }} />); };
	await act(async () => render());
	await act(async () => reactProps(dom.one('input')).onChange({ target: { value: 'Outgoing draft' } }));
	await controller.actions.project.rename('Keep same-project draft'); await act(async () => render());
	assert.equal(dom.one('input').value, 'Outgoing draft');
	await act(async () => { await controller.actions.project.openScapeFile(new File([archiveBlob], 'Incoming.sscape'), () => 'copy'); render(); });
	await act(async () => reactProps(dom.one('[data-track-name]')).onBlur());
	assert.equal(controller.project?.tracks[0]?.name, 'Voice');
	assert.ok(closed > 0);
});
