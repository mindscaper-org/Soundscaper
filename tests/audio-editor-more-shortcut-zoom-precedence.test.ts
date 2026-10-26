/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { shortcutEditorDraft } from '../src/common/editor/ui/dialogs/ShortcutEditorRow.tsx';
import { handleWorkspaceKeyboard } from '../src/common/editor/ui/workspace-shortcuts.ts';

for (const [binding, key, code, shiftKey] of [
	['Ctrl++', '+', 'NumpadAdd', false], ['Ctrl+Shift+=', '+', 'Equal', true],
] as const) test(`the accepted ${binding} assignment owns its exact event before the default zoom alias`, () => {
	const shortcuts = { undo: [binding], 'zoom-in': ['Ctrl+='] };
	assert.equal(shortcutEditorDraft({ shortcuts, preferenceId: 'undo', bindings: [binding] }).conflict, null);
	const performed: string[] = [];
	handleWorkspaceKeyboard({ key, code, ctrlKey: true, altKey: false, metaKey: false, shiftKey,
		target: null, defaultPrevented: false, preventDefault() {}, }, { preferences: { shortcuts } }, work => work(),
	{ menus: [{ id: 'undo', onClick: () => { performed.push('undo'); } }, { id: 'zoom-in', onClick: () => { performed.push('zoom-in'); } }] });
	assert.deepEqual(performed, ['undo'], 'a saved custom binding must not invoke a different command');
});
