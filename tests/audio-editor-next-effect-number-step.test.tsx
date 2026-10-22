/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ParameterNumber from '../src/common/editor/ui/inspector/EffectParameterNumber.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

(globalThis as unknown as { React: unknown }).React = React;

test('effect numeric fields carry the same descriptor bounds and steps as their sliders', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const commits: number[] = [];
	const render = async (range: [number, number] | null, step: number | undefined, value: number) => {
		await act(async () => root.render(<ParameterNumber label="Frequency" value={value}
			range={range} step={step} presentation="slider" hook="frequency" valueUnit="Hz"
			defaultValue={.4} disabled={false} timeCodeUnit={undefined}
			onGestureBegin={undefined} onGesturePreview={undefined} onGestureCommit={undefined} onGestureCancel={undefined}
			copy={{ parameterRangeError: '{label}: {minimum} to {maximum}' }} onCommit={(next: number) => commits.push(next)} />));
	};
	try {
		await render([.001, 4], .001, .4);
		const number = dom.one('.text-input__field');
		assert.equal(Reflect.get(number, 'step') as unknown, '0.001');
		assert.equal(Reflect.get(number, 'min') as unknown, '0.001');
		assert.equal(Reflect.get(number, 'max') as unknown, '4');
		await act(async () => reactProps(number).onChange({ target: { value: '.401' } }));
		await act(async () => reactProps(number).onBlur());
		assert.deepEqual(commits, [.401]);
		await render([-30, 30], .1, -6);
		assert.equal(Reflect.get(number, 'step') as unknown, '0.1');
		assert.equal(Reflect.get(number, 'min') as unknown, '-30');
		assert.equal(Reflect.get(number, 'max') as unknown, '30');
		await render(null, undefined, 1.2);
		assert.equal(Reflect.get(number, 'step') as unknown, '');
		assert.equal(Reflect.get(number, 'min') as unknown, '');
		assert.equal(Reflect.get(number, 'max') as unknown, '');
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
