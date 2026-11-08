/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SkinPreferences from '../src/common/editor/ui/skins/SkinPreferences.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const chooseLaterFocus of [false, true]) test(`skin persistence recovers disabled-control focus and preserves later choices=${chooseLaterFocus}`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const observer = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
	Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	let finish = () => {};
	const pending = new Promise<void>(resolve => { finish = resolve; });
	const controller = { actions: { preferences: { setSkin: () => pending } } };
	const root = createRoot(dom.container as unknown as Element);
	const render = (skin: string) => root.render(<><SkinPreferences controller={controller} copy={{ skin: 'Skin' }} savedSkin={skin}
		run={operation => operation()} /><button data-later-focus>Close preferences</button></>);
	try {
		await act(async () => { render('default'); });
		const chosen = dom.one('[data-skin-choice="techno"]');
		chosen.focus();
		await act(async () => { reactProps(chosen).onClick?.(); });
		assert.equal(chosen.hasAttribute('disabled'), true);
		const later = dom.one('[data-later-focus]');
		if (chooseLaterFocus) later.focus(); else document.body.focus();
		await act(async () => { finish(); await pending; render('techno'); });
		assert.equal(chosen.hasAttribute('disabled'), false);
		assert.equal(dom.container.ownerDocument.activeElement === (chooseLaterFocus ? later : chosen), true,
			'completed persistence retains the chosen carousel focus or a later user focus choice');
	} finally {
		await act(async () => root.unmount());
		if (observer) Object.defineProperty(globalThis, 'ResizeObserver', observer); else Reflect.deleteProperty(globalThis, 'ResizeObserver');
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore();
	}
});
