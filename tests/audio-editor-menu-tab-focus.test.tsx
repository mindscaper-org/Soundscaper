/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useApplicationMenuKeyboard } from '../src/common/editor/ui/useApplicationMenuKeyboard.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('deferred application-menu Tab focus yields to a later pointer focus', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const frames: FrameRequestCallback[] = [];
	globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
	const events = new EventTarget();
	window.addEventListener = events.addEventListener.bind(events);
	window.removeEventListener = events.removeEventListener.bind(events);
	const root = createRoot(dom.container as unknown as Element);
	let closed = false;
	function Fixture() {
		useApplicationMenuKeyboard({ closeMenu: () => undefined, flatNavigation: true,
			focusMenuButton: () => dom.one('[data-next-menu]').focus(), horizontalRightDelta: 1,
			menuButtonsRef: { current: [] }, menuCount: 2, openMenu: { index: 0 },
			setActiveIndex: () => undefined, setOpenMenu: () => { closed = true; } });
		return <><button data-next-menu>Edit</button><button data-outside>Stop</button>
			<div className="kw-audio-editor__application-menu"><div role="menu"><button role="menuitem">New</button></div></div></>;
	}
	try {
		await act(async () => root.render(<Fixture />));
		const item = dom.one('[role="menuitem"]');
		item.focus();
		const key = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Tab' });
		Object.defineProperty(key, 'target', { value: item });
		await act(async () => { events.dispatchEvent(key); });
		assert.equal(closed, true);
		const outside = dom.one('[data-outside]');
		outside.focus();
		await act(async () => { for (const frame of frames.splice(0)) frame(0); });
		assert.strictEqual(dom.container.ownerDocument.activeElement, outside);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
