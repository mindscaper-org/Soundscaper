/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { handleWorkspaceKeyboard } from '../src/common/editor/ui/workspace-shortcuts.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

for (const action of ['cut', 'cut-leave-gap', 'delete', 'paste', 'duplicate', 'split']) {
	test(`a source waveform shortcut cannot dispatch the timeline ${action} command`, () => {
		const dom = installReactTestDom();
		try {
			const document = dom.container.ownerDocument;
			const panel = document.createElement('div');
			panel.setAttribute('data-clip-source-editor', '');
			const waveform = document.createElement('div');
			panel.appendChild(waveform); dom.container.appendChild(panel);
			let calls = 0, prevented = false;
			const dispatch = (target: Element) => handleWorkspaceKeyboard({ key: 'F8', code: 'F8', ctrlKey: false,
				metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, target,
				preventDefault() { prevented = true; } }, { preferences: { shortcuts: { [action]: ['F8'] } } }, operation => operation(),
			{ menus: [{ id: action, onClick() { calls++; } }] });
			dispatch(waveform as unknown as Element);
			assert.equal(calls, 0, 'the source highlight cannot authorize a retained timeline edit');
			assert.equal(prevented, true, 'the blocked known shortcut is consumed');
			dispatch(dom.container as unknown as Element);
			assert.equal(calls, 1, 'the timeline still owns its configured command');
		} finally { dom.restore(); }
	});
}

for (const action of ['undo', 'redo', 'audacity-invert', 'file-save']) {
	test(`Source monitor retains the ${action} shortcut owner`, () => {
		const dom = installReactTestDom();
		try {
			const panel = dom.container.ownerDocument.createElement('div');
			panel.setAttribute('data-clip-source-editor', ''); dom.container.appendChild(panel);
			let calls = 0;
			handleWorkspaceKeyboard({ key: 'F8', code: 'F8', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
				defaultPrevented: false, target: panel as unknown as Element, preventDefault() {} },
			{ preferences: { shortcuts: { [action]: ['F8'] } } }, operation => operation(),
			{ menus: [{ id: action, onClick() { calls++; } }] });
			assert.equal(calls, 1);
		} finally { dom.restore(); }
	});
}
