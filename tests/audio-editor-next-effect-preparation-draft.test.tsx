/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ParameterNumber from '../src/common/editor/ui/inspector/EffectParameterNumber.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

(globalThis as unknown as { React: unknown }).React = React;

async function mountNumber() {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const commits: number[] = [];
	const render = async (value: number, hook = 'gainDb') => {
		await act(async () => root.render(<ParameterNumber label="Gain" value={value}
			range={[-50, 50]} step={.1} presentation="slider" hook={hook}
			valueUnit={undefined} defaultValue={0} disabled={false} timeCodeUnit={undefined}
			onGestureBegin={undefined} onGesturePreview={undefined}
			onGestureCommit={undefined} onGestureCancel={undefined}
			copy={{ parameterRangeError: '{label}: {minimum} to {maximum}' }}
			onCommit={(next: number) => commits.push(next)} />));
	};
	await render(0);
	return { dom, commits, render, async dispose() {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	} };
}

test('a computed effect default cannot replace an edited numeric draft before blur', async () => {
	const mounted = await mountNumber();
	try {
		const number = mounted.dom.one('.text-input__field');
		await act(async () => reactProps(number).onChange({ target: { value: '6' } }));
		await mounted.render(9.0466);
		assert.equal(number.value, '6');
		assert.deepEqual(mounted.commits, []);
		await act(async () => reactProps(number).onBlur());
		assert.deepEqual(mounted.commits, [6]);
		await mounted.render(6);
		await mounted.render(3);
		assert.equal(number.value, '3', 'a committed field follows subsequent authoritative values');
	} finally { await mounted.dispose(); }
});

test('untouched defaults update and Escape restores the latest computed effect value', async () => {
	const mounted = await mountNumber();
	try {
		const number = mounted.dom.one('.text-input__field');
		await mounted.render(9);
		assert.equal(number.value, '9');
		await act(async () => reactProps(number).onChange({ target: { value: '6' } }));
		await mounted.render(12);
		const target = { blur() { reactProps(number).onBlur(); } };
		await act(async () => reactProps(mounted.dom.one('[data-effect-number-input]')).onKeyDown({
			key: 'Escape', target, preventDefault() {}, stopPropagation() {},
		}));
		assert.equal(number.value, '12');
		assert.deepEqual(mounted.commits, []);
		await mounted.render(4);
		assert.equal(number.value, '4');
	} finally { await mounted.dispose(); }
});

test('an edited numeric draft does not leak into a different effect parameter', async () => {
	const mounted = await mountNumber();
	try {
		const number = mounted.dom.one('.text-input__field');
		await act(async () => reactProps(number).onChange({ target: { value: '6' } }));
		await mounted.render(-3, 'thresholdDb');
		assert.equal(number.value, '-3');
		await mounted.render(-4, 'thresholdDb');
		assert.equal(number.value, '-4');
		assert.deepEqual(mounted.commits, []);
	} finally { await mounted.dispose(); }
});
