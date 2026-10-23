/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import RoutingEdgeLevelInput, { routingLevelDraftValue } from '../src/common/editor/ui/workspace/RoutingEdgeLevelInput.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const draft of ['13', '-61', '1e308']) test(`out-of-range routing draft ${draft} cannot enter or release an automation gesture`, async () => {
	const dom = installReactTestDom();
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = environment.IS_REACT_ACT_ENVIRONMENT; environment.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const previews: number[] = [], releases: number[] = []; let cancelled = 0;
	try {
		await act(async () => root.render(<RoutingEdgeLevelInput label="Level (dB)" savedLevel={0.5} disabled={false}
			onBegin={() => undefined} onPreview={value => { previews.push(value); }} onRelease={value => { releases.push(value); }}
			onCancel={() => { cancelled++; }} hasActiveGesture={() => true} />));
		const input = dom.one('input'); input.value = '-6.02';
		await act(async () => reactProps(input).onFocus({ currentTarget: input }));
		input.value = draft; await act(async () => reactProps(input).onChange({ currentTarget: input }));
		assert.deepEqual(previews, [], 'invalid text must never preview a different audible gain');
		await act(async () => reactProps(input).onBlur({ currentTarget: input }));
		assert.deepEqual(releases, []); assert.equal(cancelled, 1); assert.equal(input.value, '-6.02');
	} finally { await act(async () => root.unmount()); environment.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
});

test('valid routing bounds and unchanged precise native gains retain their existing meaning', () => {
	assert.equal(routingLevelDraftValue('-60'), 0);
	assert.equal(routingLevelDraftValue('12.04'), 10 ** (12.04 / 20));
	assert.equal(routingLevelDraftValue('0'), 1);
	assert.equal(routingLevelDraftValue('-60', .0008), .0008);
	assert.equal(routingLevelDraftValue('12.04', 4), 4);
	assert.equal(routingLevelDraftValue(''), null);
});
