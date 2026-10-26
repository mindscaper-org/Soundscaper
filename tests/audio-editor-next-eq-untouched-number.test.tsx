/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { ParametricEqNumericInput } from '../src/common/editor/ui/ParametricEqNumericInput.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

(globalThis as unknown as { React: unknown }).React = React;

test('focusing and leaving a rounded EQ field retains exact authored precision', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const commits: number[] = [];
	const render = async (value: number) => {
		await act(async () => root.render(<ParametricEqNumericInput value={value} min={.1} max={30} step="0.01"
			disabled={false} onCommit={(next: number) => commits.push(next)} />));
	};
	try {
		await render(.1049);
		const input = dom.one('input');
		await act(async () => reactProps(input).onFocus());
		await act(async () => reactProps(input).onBlur());
		assert.deepEqual(commits, [], 'the formatted display is not a new authored Q value');
		await act(async () => reactProps(input).onFocus());
		await render(.1079);
		await act(async () => reactProps(input).onBlur());
		assert.deepEqual(commits, [], 'a source change while merely focused is not overwritten');
		await act(async () => reactProps(input).onFocus());
		await act(async () => reactProps(input).onChange({ currentTarget: { value: '.1' } }));
		await act(async () => reactProps(input).onBlur());
		assert.deepEqual(commits, [.1], 'an explicit decimal edit remains an intentional change');
	} finally {
		await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = prior; dom.restore();
	}
});
