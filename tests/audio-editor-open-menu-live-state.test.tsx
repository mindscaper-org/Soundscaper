/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AudioEditorMenuBar from '../src/common/editor/ui/AudioEditorMenuBar.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { DIRECT_ENABLED_MENU_ITEM_SELECTOR, DIRECT_MENU_ITEM_SELECTOR } from '../src/common/editor/ui/application-menu-items.jsx';

for (const keyboard of [false, true]) test(`an already-open Edit menu reflects an import completing after ${keyboard ? 'keyboard' : 'pointer'} opening`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const priorObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	const frames = new Map<number, FrameRequestCallback>();
	let frameId = 0;
	globalThis.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
	globalThis.cancelAnimationFrame = id => { frames.delete(id); };
	dom.container.setAttribute('id', 'kw-audio-editor-design-system');
	Object.defineProperty(dom.container.ownerDocument, 'querySelector', { configurable: true, value: (selector: string) => {
		if (selector === '#kw-audio-editor-design-system .kw-audio-editor__application-menu[role="menu"]') {
			return dom.container.querySelector('.kw-audio-editor__application-menu');
		}
		return dom.container.querySelector(selector);
	} });
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const render = async (importing: boolean): Promise<void> => {
		await act(async () => { root.render(<AudioEditorMenuBar appName="Soundscaper" copy={ENGLISH_COPY} locale="en"
			menus={[{ id: 'edit', label: 'Edit', items: [{ id: 'undo', label: 'Undo', disabled: importing, onClick() {} }] }]}
			onAssistanceSearchClose={() => undefined} onFullscreen={() => undefined} onSearchActivate={() => undefined}
			projectSessionKey="project-A:1" projectTabs={null} projectName="Programme" saveState="saved" saveText="Saved" />); });
	};
	try {
		await render(true);
		const trigger = dom.one('[role="menuitem"]');
		await act(async () => {
			if (keyboard) reactProps(trigger).onKeyDown?.({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
			else reactProps(trigger).onClick?.({});
		});
		const menu = dom.one('.kw-audio-editor__application-menu');
		const query = menu.querySelector.bind(menu);
		Object.defineProperty(menu, 'querySelector', { configurable: true, value: (selector: string) => {
			if (selector === DIRECT_ENABLED_MENU_ITEM_SELECTOR || selector === DIRECT_MENU_ITEM_SELECTOR) {
				return menu.querySelectorAll('[role="menuitem"]').find(item => item.parentNode === menu
					&& (selector === DIRECT_MENU_ITEM_SELECTOR || item.getAttribute('aria-disabled') !== 'true')) ?? null;
			}
			return query(selector);
		} });
		await act(async () => { for (const [id, frame] of [...frames]) { frames.delete(id); frame(0); } });
		assert.equal(menu.getAttribute('aria-label'), 'Edit', 'the real menu remains named when the opening frame runs');
		let undo = [...dom.container.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === 'Undo');
		assert.ok(undo);
		assert.equal(undo.getAttribute('aria-disabled'), 'true');
		await render(false);
		undo = [...dom.container.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === 'Undo');
		assert.ok(undo);
		assert.notEqual(undo.getAttribute('aria-disabled'), 'true');
	} finally {
		await act(async () => { root.unmount(); });
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		if (priorObserver) Object.defineProperty(globalThis, 'MutationObserver', priorObserver);
		else Reflect.deleteProperty(globalThis, 'MutationObserver');
		dom.restore();
	}
});
