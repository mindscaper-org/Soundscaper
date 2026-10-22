/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SoundscaperMasteringSequenceDialog from '../src/common/editor/ui/dialogs/SoundscaperMasteringSequenceDialog.tsx';
import { SOUNDSCAPER_MASTERING_SEQUENCE_COPY } from '../src/common/editor/ui/soundscaper-mastering-sequence-copy.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

function project(id: string) {
	return createSoundscaperProject({ id, primarySequenceId: 'main', sequences: [{ id: 'main', trackIds: [] }],
		timelineAnnotations: [{ id: 'region', sequenceId: 'main', kind: 'region', anchor: 'sample', name: 'Region',
			startFrame: 0, endFrame: 48_000, color: 'auto', batchId: null, opaqueExtensions: {} }],
		masteringSequences: [{ id: 'album', sequenceId: 'main', name: 'Album order', entries: [{ id: 'entry', annotationId: 'region' }] }],
	});
}

test('MP45: mastering delivery drafts cannot overwrite a subsequently opened project with matching entry IDs', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const dom = installReactTestDom(); const root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await act(async () => root.unmount()); await controller.dispose();
		globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore(); });
	await controller.ready; await controller.actions.project.open(project('first'));
	const render = async () => await act(async () => root.render(<SoundscaperMasteringSequenceDialog controller={controller}
		snapshot={controller.getSnapshot()} copy={SOUNDSCAPER_MASTERING_SEQUENCE_COPY} run={work => work()} onClose={() => undefined} />));
	await render();
	const field = (name: string) => { const node = dom.container.querySelectorAll('input').find(input => input.name === name); assert.ok(node); return node; };
	const name = field('name');
	await act(async () => { reactProps(name).onChange({ currentTarget: { value: 'Old album draft' } }); });
	const entryTitle = field('title'); entryTitle.value = 'Old delivery title';
	await controller.actions.project.rename('Same project publication'); await render();
	assert.equal(field('name').value, 'Old album draft');
	assert.equal(field('title').value, 'Old delivery title');
	await controller.actions.project.open(project('second')); await render();
	assert.equal(field('name').value, 'Album order');
	assert.equal(field('title').value, '');
});
