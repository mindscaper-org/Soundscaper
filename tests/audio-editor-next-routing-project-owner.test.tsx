/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import SoundscaperRoutingGraphView from '../src/common/editor/ui/workspace/SoundscaperRoutingGraphView.tsx';
import { addSoundscaperRoutingItem } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-candidates.ts';
import { SOUNDSCAPER_ROUTING_GRAPH_COPY as copy } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-copy.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

function project(id: string) {
	const base = createSoundscaperProject({ id, title: id });
	return createSoundscaperProject({ ...base, mixer: addSoundscaperRoutingItem(base, base.mixer, 'cue').graph });
}

test('NP020: routing delete confirmation cannot delete a node in another native project', async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const dom = installReactTestDom();
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT; environment.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const current = () => { const value: unknown = controller.project; assert.ok(validateSoundscaperProject(value)); return value; };
	const render = async () => {
		const owner = current();
		await act(async () => root.render(<SoundscaperRoutingGraphView controller={controller} project={owner} graph={owner.mixer}
			copy={copy} dismissLabel="Close" disabled={false} onCommit={gesture => {
				controller.actions.edit.commit({ type: 'mixer-graph/set', expected: owner.mixer, mixer: gesture.graph });
			}} />));
	};
	const confirmation = () => dom.container.querySelectorAll('button').find(button => button.textContent === copy.confirmDelete);
	const requestDeletion = async () => {
		const cue = dom.one(`[data-routing-node="mixer-node:${current().mixer.cues[0]!.id}"]`).querySelector('button'); assert.ok(cue);
		await act(async () => reactProps(cue).onKeyDown({ key: 'Delete', preventDefault() {}, stopPropagation() {} }));
	};
	try {
		await controller.actions.project.open(project('outgoing')); await render(); await requestDeletion();
		assert.ok(confirmation());
		await controller.actions.project.rename('Same project update'); await render();
		assert.ok(confirmation(), 'ordinary immutable publications preserve an active confirmation');
		await controller.actions.project.open(project('incoming')); await render();
		const stale = confirmation();
		if (stale) await act(async () => reactProps(stale).onClick());
		assert.equal(current().mixer.cues.length, 1, 'an outgoing confirmation must not delete the incoming node');
		assert.equal(confirmation(), undefined);
		await requestDeletion(); const confirm = confirmation(); assert.ok(confirm);
		await act(async () => reactProps(confirm).onClick());
		assert.equal(current().mixer.cues.length, 0, 'a fresh confirmation still applies its own native command');
		controller.actions.edit.undo(); assert.equal(current().mixer.cues.length, 1);
	} finally {
		await act(async () => root.unmount()); environment.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore();
	}
});
