/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Flyout } from '../vendor/audacity-design-system/components/src/Flyout/Flyout.tsx';
import { installReactTestDom, ReactTestElement } from './helpers/react-test-dom.ts';

test('flyout content resizes defer bounds updates outside observer delivery and cancel on close', async context => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.assign(window, { innerWidth: 1280, innerHeight: 900 });
	let notify = (): void => undefined;
	let disconnected = false;
	let observerCount = 0;
	Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class implements ResizeObserver {
		constructor(callback: ResizeObserverCallback) { observerCount++; notify = () => callback([], this); }
		observe(): void {}
		unobserve(): void {}
		disconnect(): void { disconnected = true; }
	} });
	const frames = new Map<number, FrameRequestCallback>();
	let ordinal = 0;
	context.mock.method(globalThis, 'requestAnimationFrame', (callback: FrameRequestCallback) => {
		frames.set(++ordinal, callback);
		return ordinal;
	});
	context.mock.method(globalThis, 'cancelAnimationFrame', (id: number) => { frames.delete(id); });
	let width = 100;
	const measure = context.mock.method(ReactTestElement.prototype, 'getBoundingClientRect', () => (
		{ x: 0, y: 0, left: 0, top: 0, right: width, bottom: 30, width, height: 30, toJSON() {} }
	));
	const render = (open: boolean, text = 'Tooltip') => root.render(<Flyout isOpen={open} x={500} y={100}
		closeOnOutsideClick={false} closeOnEscape={false} onClose={() => undefined}>{text}</Flyout>);
	try {
		await act(async () => { render(true); });
		const flyout = dom.one('.flyout');
		assert.equal(Reflect.get(flyout.style, 'left'), '450px', 'initial bounds are ready before paint');
		const initialMeasures = measure.mock.callCount();
		width = 200;
		await act(async () => { notify(); notify(); });
		assert.equal(measure.mock.callCount(), initialMeasures, 'observer delivery must not measure and update its own target');
		assert.equal(frames.size, 1, 'repeated content resizes share one frame');
		await act(async () => {
			for (const [id, callback] of frames) { frames.delete(id); callback(16); }
		});
		assert.equal(Reflect.get(flyout.style, 'left'), '400px', 'the next frame uses the new content bounds');
		assert.equal(measure.mock.callCount(), initialMeasures + 1);
		width = 240;
		await act(async () => { render(true, 'Changed tooltip content'); });
		assert.equal(Reflect.get(flyout.style, 'left'), '380px', 'updated children are measured before paint');
		assert.equal(observerCount, 1, 'content updates retain the active observer');
		assert.equal(disconnected, false);
		notify();
		assert.equal(frames.size, 1);
		await act(async () => { render(false); });
		assert.equal(disconnected, true);
		assert.equal(frames.size, 0, 'closed flyouts release pending position work');
	} finally {
		await act(async () => { root.unmount(); });
		context.mock.restoreAll();
		if (priorObserver) Object.defineProperty(globalThis, 'ResizeObserver', priorObserver);
		else Reflect.deleteProperty(globalThis, 'ResizeObserver');
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
