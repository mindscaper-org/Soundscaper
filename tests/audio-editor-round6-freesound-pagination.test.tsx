/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useLayoutEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import FreesoundPanel, { type FreesoundPanelState, type FreesoundSearchRequest } from '../src/common/editor/ui/workspace/FreesoundPanel.tsx';
import { FREESOUND_ATTRIBUTION_COPY_BY_LOCALE } from '../src/common/i18n/freesound-attribution-copy.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('Freesound preserves a query entered at mount and paginates the displayed results', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const requests: FreesoundSearchRequest[] = [];
	const state: FreesoundPanelState = {
		query: 'rain', license: 'commercial', sort: 'rating', page: 1, pageCount: 3,
		totalResults: 60, status: 'ready', previewingSoundId: null, previewPaused: false, results: [],
	};
	function EditBeforePassiveEffects({ children }: { readonly children: ReactNode }) {
		useLayoutEffect(() => {
			reactProps(dom.one('input')).onChange({ currentTarget: { value: 'wind' } });
		}, []);
		return children;
	}
	try {
		const panel = (state: FreesoundPanelState) => <FreesoundPanel copy={FREESOUND_ATTRIBUTION_COPY_BY_LOCALE.en}
			state={state} disabled={false} onSearch={request => { requests.push(request); }}
			onPreview={() => undefined} onPausePreview={() => undefined} onResumePreview={() => undefined}
			onSeekPreview={() => undefined} onInsertAtPlayhead={() => undefined} onAddToProjectBin={() => undefined} />;
		await act(async () => root.render(<EditBeforePassiveEffects>{panel(state)}</EditBeforePassiveEffects>));
		const input = dom.one('input');
		assert.equal(input.value, 'wind', 'the initial draft survives the mount effects');
		for (const [label, page] of [['Next', 2], ['Previous', 1]] as const) {
			const button = dom.container.querySelectorAll('button').find(candidate => candidate.textContent === label);
			assert.ok(button);
			await act(async () => { reactProps(button).onClick({}); });
			assert.deepEqual(requests.at(-1), { query: 'rain', license: 'commercial', sort: 'rating', page });
			await act(async () => root.render(<EditBeforePassiveEffects>{panel({ ...state, page })}</EditBeforePassiveEffects>));
			assert.equal(input.value, 'wind', 'paging does not consume an unsubmitted draft');
		}
		await act(async () => { reactProps(dom.one('form')).onSubmit({ preventDefault() {} }); });
		assert.deepEqual(requests.at(-1), { query: 'wind', license: 'commercial', sort: 'rating', page: 1 });
		await act(async () => root.render(<EditBeforePassiveEffects>{panel({ ...state, query: 'gusts' })}</EditBeforePassiveEffects>));
		assert.equal(input.value, 'gusts', 'a changed committed query still updates the field');
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
