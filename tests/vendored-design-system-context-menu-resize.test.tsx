/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ContextMenu } from '../vendor/audacity-design-system/components/src/ContextMenu/ContextMenu.tsx';
import { installReactTestDom, ReactTestElement } from './helpers/react-test-dom.ts';

test('an open menu follows viewport bounds and restores its anchor when space returns', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const priorRect = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getBoundingClientRect');
	Object.defineProperty(ReactTestElement.prototype, 'getBoundingClientRect', { configurable: true, value(this: ReactTestElement) {
		const left = Number.parseFloat(String(Reflect.get(this.style, 'left') ?? 0));
		const top = Number.parseFloat(String(Reflect.get(this.style, 'top') ?? 0));
		return { left, top, right: left + 220, bottom: top + 180, x: left, y: top, width: 220, height: 180, toJSON() {} };
	} });
	Object.assign(window, { innerWidth: 1280, innerHeight: 844 });
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
	const resize = async (width: number): Promise<void> => {
		Object.assign(window, { innerWidth: width });
		await act(async () => {
			for (const listener of listeners.get('resize') ?? []) {
				if (typeof listener === 'function') listener.call(window, new Event('resize'));
				else listener.handleEvent(new Event('resize'));
			}
		});
	};
	try {
		await act(async () => { root.render(<ContextMenu isOpen x={620} y={44} autoFocus={false} onClose={() => undefined}>
			<div role="menuitem">About Soundscaper</div>
		</ContextMenu>); });
		const menu = dom.one('[role="menu"]');
		assert.equal(menu.getBoundingClientRect().left, 620);
		await resize(390);
		assert.ok(menu.getBoundingClientRect().right <= 390, 'all menu actions remain in the smaller viewport');
		await resize(1280);
		assert.equal(menu.getBoundingClientRect().left, 620, 'the menu returns to its original anchor');
	} finally {
		await act(async () => { root.unmount(); });
		assert.equal(listeners.get('resize')?.size ?? 0, 0);
		if (priorRect) Object.defineProperty(ReactTestElement.prototype, 'getBoundingClientRect', priorRect);
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
