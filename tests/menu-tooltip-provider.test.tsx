/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { MenuTooltipProvider } from '../src/common/editor/ui/MenuTooltipProvider.tsx';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('hover explanations render rich content for disabled entries and dispose pending work', async (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	Object.assign(window, { innerWidth: 1024, innerHeight: 768 });
	const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
	document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (!listener) return;
		if (!listeners.has(type)) listeners.set(type, new Set());
		listeners.get(type)!.add(listener);
	};
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (listener) listeners.get(type)?.delete(listener); };
	const emit = (type: string, event: unknown) => {
		for (const listener of listeners.get(type) ?? []) {
			if (typeof listener === 'function') listener(event as Event);
			else listener.handleEvent(event as Event);
		}
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<MenuTooltipProvider resolveShortcut={label => label === 'Assigned' ? 'Alt+9' : ''} resolve={() => <><p>Explain the outcome.</p><img src="example.png" alt="Example diagram" /></>}>
			<div role="menu"><button role="menuitem" aria-disabled="true" data-menu-tooltip-id="example"><span className="context-menu-item-label">Example</span><span className="context-menu-item-shortcut">Ctrl+Alt+E, F8</span></button>
				<button role="menuitem" data-menu-tooltip-id="assigned">Assigned</button>
				<button role="menuitem" data-menu-tooltip-id="local" aria-keyshortcuts="Control+N">Local</button>
				<div role="menuitem" data-menu-tooltip-id="parent"><span className="context-menu-item-label">Parent</span>
					<div role="menu"><div role="menuitem"><span className="context-menu-item-shortcut">F4</span></div></div>
				</div>
			</div>
		</MenuTooltipProvider>));
		const item = dom.one('[role="menuitem"]');
		await act(async () => { emit('pointerover', { target: item, pointerType: 'mouse' }); });
		assert.equal(document.body.querySelector('[role="tooltip"]'), null, 'hover waits before opening');
		await act(async () => context.mock.timers.tick(450));
		const tooltip = document.body.querySelector('[role="tooltip"]');
		assert.ok(tooltip);
		assert.equal(tooltip.textContent, 'Explain the outcome.Ctrl+Alt+E, F8');
		assert.equal(tooltip.querySelector('kbd')?.textContent, 'Ctrl+Alt+E, F8');
		assert.equal(tooltip.querySelector('img')?.getAttribute('alt'), 'Example diagram');
		assert.equal(item.getAttribute('aria-describedby'), tooltip.getAttribute('id'));
		await act(async () => { emit('pointerdown', { target: item }); });
		assert.equal(document.body.querySelector('[role="tooltip"]'), null);
		assert.equal(item.getAttribute('aria-describedby'), null);
		for (const [id, shortcut] of [['assigned', 'Alt+9'], ['local', 'Control+N'], ['parent', null]]) {
			const target = dom.one(`[data-menu-tooltip-id="${id}"]`);
			await act(async () => { emit('pointerover', { target, pointerType: 'mouse' }); context.mock.timers.tick(450); });
			assert.equal(document.body.querySelector('[role="tooltip"]')?.querySelector('kbd')?.textContent ?? null, shortcut);
		}
		await act(async () => { emit('pointerdown', { target: item }); emit('pointerover', { target: item, pointerType: 'mouse' }); });
		await act(async () => root.unmount());
		await act(async () => context.mock.timers.tick(450));
		assert.equal(document.body.querySelector('[role="tooltip"]'), null);
		for (const type of ['pointerover', 'pointerout', 'pointermove', 'pointerdown', 'keydown', 'focusin', 'focusout', 'scroll']) {
			assert.equal(listeners.get(type)?.size ?? 0, 0, type);
		}
	} finally {
		await act(async () => root.unmount());
		context.mock.timers.reset();
		if (priorObserver) Object.defineProperty(globalThis, 'MutationObserver', priorObserver);
		else Reflect.deleteProperty(globalThis, 'MutationObserver');
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
