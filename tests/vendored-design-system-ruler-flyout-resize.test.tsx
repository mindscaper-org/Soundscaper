/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RulerFlyout } from '../vendor/audacity-design-system/components/src/RulerFlyout/RulerFlyout.tsx';
import { installReactTestDom, ReactTestElement } from './helpers/react-test-dom.ts';

test('an open ruler flyout keeps its frequency fields onscreen without replacing focused input', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const previousRect = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getBoundingClientRect');
	Object.defineProperty(ReactTestElement.prototype, 'getBoundingClientRect', { configurable: true,
		value(this: ReactTestElement) {
			const left = Number.parseFloat(String(Reflect.get(this.style, 'left') ?? 0));
			const top = Number.parseFloat(String(Reflect.get(this.style, 'top') ?? 0));
			return { left, top, right: left + 200, bottom: top + 416, x: left, y: top, width: 200, height: 416, toJSON() {} };
		} });
	Object.assign(window, { innerWidth: 1280, innerHeight: 900 });
	const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
	Object.defineProperties(window, {
		addEventListener: { configurable: true, value(type: string, listener: EventListenerOrEventListenerObject) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)!.add(listener);
		} },
		removeEventListener: { configurable: true, value(type: string, listener: EventListenerOrEventListenerObject) {
			listeners.get(type)?.delete(listener);
		} },
	});
	const root = createRoot(dom.container as unknown as HTMLElement);
	const resize = async (height: number): Promise<void> => {
		Object.assign(window, { innerHeight: height });
		await act(async () => {
			for (const listener of listeners.get('resize') ?? []) {
				if (typeof listener === 'function') listener.call(window, new Event('resize'));
				else listener.handleEvent(new Event('resize'));
			}
		});
	};
	try {
		await act(async () => root.render(<RulerFlyout isOpen mode="spectrogram" x={808} y={462} onClose={() => undefined} />));
		await act(async () => { await new Promise<void>(resolve => { setTimeout(resolve, 1); }); });
		const flyout = dom.one('.ruler-flyout');
		const input = dom.container.querySelectorAll('.number-stepper__input').at(-1);
		assert.ok(input); input.focus();
		await resize(700);
		assert.ok(flyout.getBoundingClientRect().bottom <= 700, 'all existing controls remain reachable after resize');
		assert.strictEqual(document.activeElement, input, 'repositioning retains the native editing owner');
		await resize(900);
		assert.equal(flyout.getBoundingClientRect().top, 462, 'the original anchor returns when room is available');
		await act(async () => root.render(<RulerFlyout isOpen={false} mode="spectrogram" x={808} y={462} onClose={() => undefined} />));
		assert.equal(listeners.get('resize')?.size ?? 0, 0, 'closed flyouts release bounds tracking');
	} finally {
		await act(async () => root.unmount());
		if (previousRect) Object.defineProperty(ReactTestElement.prototype, 'getBoundingClientRect', previousRect);
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore();
	}
});
