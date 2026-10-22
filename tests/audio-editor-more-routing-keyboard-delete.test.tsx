/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import SoundscaperRoutingGraphView from '../src/common/editor/ui/workspace/SoundscaperRoutingGraphView.tsx';
import type { SoundscaperRoutingGraphCommit } from '../src/common/editor/ui/workspace/SoundscaperRoutingGraphView.tsx';
import { addSoundscaperRoutingItem } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-candidates.ts';
import { SOUNDSCAPER_ROUTING_GRAPH_COPY as copy } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-copy.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('routing keyboard deletion retains its confirmation after selecting the target', async () => {
	const dom = installReactTestDom();
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const project = createSoundscaperProject();
	const added = addSoundscaperRoutingItem(project, project.mixer, 'cue');
	const commits: SoundscaperRoutingGraphCommit[] = [];
	try {
		await act(async () => root.render(<SoundscaperRoutingGraphView project={project} graph={added.graph}
			copy={copy} dismissLabel="Close" disabled={false} onCommit={commit => { commits.push(commit); }} />));
		const node = dom.one(`[data-routing-node="mixer-node:${added.selection.id}"]`).querySelector('button');
		assert.ok(node);
		await act(async () => reactProps(node).onKeyDown({ key: 'Delete', preventDefault() {}, stopPropagation() {} }));
		const confirm = dom.container.querySelectorAll('button').find(button => button.textContent === copy.confirmDelete);
		assert.ok(confirm, 'selection effects must not erase the keyboard delete request');
		await act(async () => reactProps(confirm).onClick());
		assert.equal(commits[0]?.kind, 'node-delete');
		assert.equal(commits[0]?.graph.cues.length, 0);
	} finally {
		await act(async () => root.unmount());
		environment.IS_REACT_ACT_ENVIRONMENT = previous;
		dom.restore();
	}
});
