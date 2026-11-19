/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AudioEditorMenuBar from '../src/common/editor/ui/AudioEditorMenuBar.jsx';
import { DIRECT_ENABLED_MENU_ITEM_SELECTOR, DIRECT_MENU_ITEM_SELECTOR } from '../src/common/editor/ui/application-menu-items.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('keyboard opening still focuses the first enabled item on its initial frame', async () => {
	const menu = await mountMenu();
	try {
		await menu.render('initial'); await menu.open(true);
		assert.equal(document.activeElement, menu.trigger());
		await menu.flushFrames();
		assert.equal(document.activeElement, menu.item('First'));
	} finally { await menu.dispose(); }
});

test('pointer opening does not acquire keyboard autofocus', async () => {
	const menu = await mountMenu();
	try {
		await menu.render('initial'); await menu.open(false);
		await menu.flushFrames();
		assert.equal(document.activeElement, menu.trigger());
	} finally { await menu.dispose(); }
});

test('initial keyboard frame preserves a menu item selected before that frame', async () => {
	const menu = await mountMenu();
	try {
		await menu.render('initial'); await menu.open(true);
		const selected = menu.item('Second'); selected.focus();
		assert.ok(menu.popup().contains(selected), 'the chosen focus belongs to the current mounted popup');
		await menu.flushFrames();
		assert.equal(document.activeElement, selected, 'initial autofocus must not replace an existing menu selection');
	} finally { await menu.dispose(); }
});

test('availability refresh before the initial frame still completes pending keyboard autofocus', async () => {
	const menu = await mountMenu();
	try {
		await menu.render('initial'); await menu.open(true);
		await menu.render('refreshed'); await menu.flushFrames();
		assert.equal(document.activeElement, menu.item('First'));
	} finally { await menu.dispose(); }
});

test('availability refresh before the initial frame preserves the already selected menu item', async () => {
	const menu = await mountMenu();
	try {
		await menu.render('initial'); await menu.open(true);
		const selected = menu.item('Second'); selected.focus();
		await menu.render('refreshed');
		assert.equal(menu.item('Second'), selected, 'refresh retains the keyed item and its selection');
		await menu.flushFrames();
		assert.equal(document.activeElement, selected, 'refreshed initial autofocus must not replace the selected item');
	} finally { await menu.dispose(); }
});

test('availability refresh after completed initial focus preserves subsequent menu selection', async () => {
	const menu = await mountMenu();
	try {
		await menu.render('initial'); await menu.open(true); await menu.flushFrames();
		const selected = menu.item('Second'); selected.focus();
		await menu.render('refreshed'); await menu.flushFrames();
		assert.equal(document.activeElement, selected);
	} finally { await menu.dispose(); }
});

async function mountMenu() {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const previous = new Map<string, PropertyDescriptor | undefined>();
	const replace = (name: string, value: unknown) => {
		previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
	};
	replace('React', React);
	replace('MutationObserver', class { observe() {} disconnect() {} });
	const frames = new Map<number, FrameRequestCallback>(); let frameId = 0;
	replace('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
	replace('cancelAnimationFrame', (id: number) => { frames.delete(id); });
	const popup = () => dom.one('.kw-audio-editor__application-menu');
	document.querySelector = ((selector: string) => selector.includes('.kw-audio-editor__application-menu') ? popup() : null) as typeof document.querySelector;
	const trigger = () => dom.one('[aria-haspopup="menu"]');
	const item = (label: string) => {
		const found = popup().querySelectorAll('[role="menuitem"]').find(node => node.textContent === label);
		assert.ok(found, `Missing menu item ${label}`); return found;
	};
	return {
		popup, trigger, item,
		async render(revision: string) {
			await act(async () => { root.render(<AudioEditorMenuBar appName="Soundscaper" copy={ENGLISH_COPY}
				locale="en" menus={[{ id: 'file', label: 'File', items: [
					{ id: 'unavailable', label: 'Unavailable', disabled: true },
					{ id: 'first', label: 'First' }, { id: 'second', label: 'Second' },
				] }]} menuAvailabilityRevision={revision} searchEnabled={false}
				onAssistanceSearchClose={() => undefined} onFullscreen={() => undefined} onSearchActivate={() => undefined}
				projectTabs={null} projectName="Untitled" saveState="saved" saveText="" />); });
		},
		async open(keyboard: boolean) {
			const button = trigger(); button.focus();
			await act(async () => {
				if (keyboard) reactProps(button).onKeyDown?.({ key: 'ArrowDown', preventDefault() {} });
				else reactProps(button).onClick?.({});
			});
			// The shared DOM lacks :scope/direct-child selectors. Bridge only
			// these selectors to actual mounted nodes; production owns the RAF.
			const node = popup(); const queryAll = node.querySelectorAll.bind(node);
			node.querySelectorAll = (selector: string) => {
				if (selector === DIRECT_MENU_ITEM_SELECTOR) return queryAll('[role="menuitem"]');
				if (selector === DIRECT_ENABLED_MENU_ITEM_SELECTOR) return queryAll('[role="menuitem"]').filter(item => item.getAttribute('aria-disabled') !== 'true');
				return queryAll(selector);
			};
		},
		async flushFrames() {
			await act(async () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(0); } });
		},
		async dispose() {
			await act(async () => { root.unmount(); });
			for (const [name, descriptor] of previous) {
				if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
			}
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			dom.restore();
		},
	};
}
