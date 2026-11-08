/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Slider } from '../vendor/audacity-design-system/components/src/Slider/Slider.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('native Slider Escape retires the held pointer before fresh pointer and keyboard edits', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const calls: string[] = [];
	const pointer = (pointerId: number, buttons = 1) => ({ pointerId, buttons, button: 0,
		pointerType: 'mouse', isPrimary: true, preventDefault() {} });
	const key = (name: string) => ({ key: name, preventDefault() {}, stopPropagation() {} });
	const change = (value: string) => { const element = { value }; return { target: element, currentTarget: element }; };
	try {
		await act(async () => { root.render(<Slider value={50} onChange={value => { calls.push(`change:${value}`); }}
			onGestureStart={() => { calls.push('begin'); }} onGestureEnd={value => { calls.push(`end:${value}`); }}
			onGestureCancel={() => { calls.push('cancel'); }} />); });
		const props = reactProps(dom.one('input'));
		await act(async () => {
			props.onPointerDown?.(pointer(1));
			props.onChange?.(change('60'));
			props.onKeyDown?.(key('Escape'));
			const canceled = change('80');
			props.onChange?.(canceled);
			assert.deepEqual(calls, ['begin', 'change:60', 'cancel']);
			assert.equal(canceled.currentTarget.value, '50');
			props.onPointerUp?.(pointer(1, 0));
			props.onChange?.(change('90'));
			assert.deepEqual(calls, ['begin', 'change:60', 'cancel']);
			props.onPointerDown?.(pointer(2));
			props.onChange?.(change('70'));
			props.onPointerUp?.(pointer(2, 0));
			props.onKeyDown?.(key('ArrowLeft'));
			props.onChange?.(change('69'));
			props.onKeyUp?.(key('ArrowLeft'));
			assert.deepEqual(calls, ['begin', 'change:60', 'cancel', 'begin', 'change:70', 'end:70', 'begin', 'change:69', 'end:69']);
		});
	} finally {
		await act(async () => { root.unmount(); });
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
