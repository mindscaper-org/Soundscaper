/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createStatusHelpSession } from '../src/common/editor/controller/composition/status-help-session.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('status help opts in, coalesces live input, dims in the background and retires every listener', () => {
	const dom = installReactTestDom();
	try {
		const root = dom.container as unknown as HTMLElement;
		const button = document.createElement('button');
		root.appendChild(button);
		const listeners = new Map<string, EventListener>();
		const windowListeners = new Map<string, EventListener>();
		const frames = new Map<number, FrameRequestCallback>();
		let frameId = 0;
		Object.defineProperties(root, {
			addEventListener: { value: (type: string, listener: EventListener) => { listeners.set(type, listener); } },
			removeEventListener: { value: (type: string) => { listeners.delete(type); } },
		});
		Object.defineProperties(window, {
			addEventListener: { value: (type: string, listener: EventListener) => { windowListeners.set(type, listener); } },
			removeEventListener: { value: (type: string) => { windowListeners.delete(type); } },
			requestAnimationFrame: { value: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; } },
			cancelAnimationFrame: { value: (id: number) => { frames.delete(id); } },
		});
		Object.defineProperty(document, 'hasFocus', { value: () => true });
		const flush = () => { for (const [id, callback] of frames) { frames.delete(id); callback(0); } };
		const session = createStatusHelpSession();
		let reads = 0;
		const resolve = (element: Element | null) => { reads += 1; return element === button ? button.getAttribute('aria-label') : null; };
		session.attach(root, resolve)();
		assert.equal(listeners.size, 0, 'disabled help owns no browser listeners');
		session.setEnabled(true);
		const dispose = session.attach(root, resolve);
		flush();
		button.setAttribute('aria-label', 'Volume: −8 dB');
		listeners.get('pointerover')?.({ target: button } as unknown as Event);
		listeners.get('pointermove')?.({ target: button } as unknown as Event);
		assert.equal(frames.size, 1);
		const before = reads;
		flush();
		assert.equal(reads, before + 1);
		assert.equal(session.getSnapshot().text, 'Volume: −8 dB');
		button.setAttribute('aria-label', 'Volume: −2 dB');
		listeners.get('input')?.({ target: button } as unknown as Event);
		flush();
		assert.equal(session.getSnapshot().text, 'Volume: −2 dB');
		windowListeners.get('blur')?.({} as Event);
		assert.equal(session.getSnapshot().backgrounded, true);
		assert.equal(session.getSnapshot().text, null);
		windowListeners.get('focus')?.({} as Event);
		assert.equal(session.getSnapshot().backgrounded, false);
		dispose();
		dispose();
		assert.equal(frames.size, 0);
		assert.equal(listeners.size, 0);
		assert.equal(windowListeners.size, 0);
		session.setEnabled(false);
		assert.equal(session.getSnapshot().text, null);
		assert.equal(session.getEnabled(), false);
	} finally { dom.restore(); }
});
