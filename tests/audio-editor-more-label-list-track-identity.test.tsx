/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import LabelManagerList from '../src/common/editor/ui/workspace/LabelManagerList.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const interaction of ['draft', 'removal-focus'] as const) {
	test(`MI24: the Labels panel scopes ${interaction} to track plus label identity`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		let labels = ['first', 'second'].map(trackId => ({ id: 'intro', trackId, trackName: trackId,
			title: 'Original', startFrame: 0, endFrame: 48_000 }));
		const updates: unknown[] = [];
		const controller = { actions: { labels: {
			update(trackId: string, labelId: string, changes: unknown) { updates.push({ trackId, labelId, changes }); },
			remove(trackId: string) { labels = labels.filter(label => label.trackId !== trackId); },
		}, timeline: { setExactSelection() {} } } };
		const render = () => root.render(<LabelManagerList projectId="project" labels={labels} sampleRate={48_000}
			copy={ENGLISH_COPY} disabled={false} controller={controller} run={operation => operation()} onAdd={() => undefined} />);
		const control = (track: string, selector: string) => {
			const element = dom.one(`[data-track-id="${track}"]`).querySelector(selector); assert.ok(element); return element;
		};
		try {
			await act(async () => { render(); });
			if (interaction === 'draft') {
				await act(async () => { reactProps(control('first', 'input')).onChange({ currentTarget: { value: 'First-track draft' } }); });
				labels = labels.filter(label => label.trackId !== 'first');
			} else {
				const remove = control('first', '.kw-audio-editor__workspace-panel-close'); remove.focus();
				await act(async () => { reactProps(remove).onClick({ currentTarget: remove }); });
			}
			await act(async () => { render(); });
			if (interaction === 'draft') {
				await act(async () => { reactProps(control('second', 'input')).onBlur({}); });
				assert.deepEqual(updates, [], 'a removed track draft cannot be committed into a different label with the same local ID');
				assert.equal(control('second', 'input').value, 'Original');
			} else assert.strictEqual(dom.container.ownerDocument.activeElement,
				control('second', '.kw-audio-editor__workspace-panel-close'), 'the surviving track label receives deletion focus');
		} finally {
			await act(async () => root.unmount());
			dom.restore(); globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}
