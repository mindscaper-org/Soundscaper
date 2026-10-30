/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import AudioEditorDialogShell from '../src/common/editor/ui/AudioEditorDialogShell.tsx';
import { focusOpenedWorkspacePanel } from '../src/common/editor/ui/workspace/workspace-panel-opening-focus.ts';
import { focusWorkspacePanelMenuButton } from '../src/common/editor/ui/workspace/workspace-panel-focus.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

function installFrames(): { flush(): void } {
	const callbacks = new Map<number, FrameRequestCallback>();
	let id = 0;
	globalThis.requestAnimationFrame = callback => { callbacks.set(++id, callback); return id; };
	globalThis.cancelAnimationFrame = handle => { callbacks.delete(handle); };
	return { flush() {
		const pending = [...callbacks.values()]; callbacks.clear();
		for (const callback of pending) callback(0);
	} };
}

for (const modal of [false, true]) for (const transfer of ['unchanged', 'workspace', 'dialog'] as const) {
	test(`deferred ${modal ? 'modal' : 'nonmodal'} dialog focus respects a ${transfer} focus target`, async () => {
		const dom = installReactTestDom(), frames = installFrames();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const render = async (open: boolean): Promise<void> => {
			await act(async () => { root.render(<div data-audio-editor>
				<button type="button" data-opener>Open settings</button>
				<button type="button" data-workspace-control>Panel menu</button>
				<AudioEditorDialogShell title="Settings" isOpen={open} modal={modal} initialFocus="dialog">
					<button type="button" data-initial>First setting</button>
					<button type="button" data-chosen>Chosen setting</button>
				</AudioEditorDialogShell>
			</div>); });
		};
		try {
			await render(false); dom.one('[data-opener]').focus();
			await render(true);
			if (transfer === 'workspace') dom.one('[data-workspace-control]').focus();
			if (transfer === 'dialog') dom.one('[data-chosen]').focus();
			await act(async () => { frames.flush(); });
			const expected = transfer === 'dialog' ? '[data-chosen]'
				: transfer === 'workspace' && !modal ? '[data-workspace-control]' : '[role="dialog"]';
			assert.equal(dom.container.ownerDocument.activeElement === dom.one(expected), true);
		} finally {
			await act(async () => { root.unmount(); });
			dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		}
	});
}

test('a deferred panel opening preserves focus handed to a different workspace control', () => {
	const dom = installReactTestDom();
	try {
		const owner = dom.container.ownerDocument;
		const panel = owner.createElement('section'), opener = owner.createElement('button'), next = owner.createElement('button');
		dom.container.appendChild(panel); dom.container.appendChild(opener); dom.container.appendChild(next);
		opener.focus(); const initialFocus = document.activeElement;
		next.focus();
		focusOpenedWorkspacePanel(panel as unknown as HTMLElement, initialFocus);
		assert.equal(owner.activeElement === next, true);
	} finally { dom.restore(); }
});

for (const transfer of [false, true]) test(`a deferred panel remount ${transfer ? 'preserves later user focus' : 'restores its opener'}`, () => {
	const dom = installReactTestDom(), frames = installFrames();
	try {
		const owner = dom.container.ownerDocument;
		const old = owner.createElement('button'), next = owner.createElement('button'), replacement = owner.createElement('button');
		const holder = owner.createElement('section'); holder.setAttribute('data-workspace-panel-menu', 'effects');
		holder.appendChild(replacement);
		for (const element of [old, next, holder]) dom.container.appendChild(element);
		old.focus();
		focusWorkspacePanelMenuButton({
			get activeElement() { return owner.activeElement; }, body: owner.body, documentElement: owner.documentElement,
			querySelectorAll: (selector: string) => {
				assert.equal(selector, '[data-workspace-panel-menu="effects"] button'); return [replacement];
			},
		}, 'effects', old);
		if (transfer) next.focus();
		frames.flush();
		assert.equal(owner.activeElement === (transfer ? next : replacement), true);
	} finally { dom.restore(); }
});
