/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorPreferencesV1 } from '../src/common/editor/preferences.js';
import { shortcutEditorDraft } from '../src/common/editor/ui/dialogs/ShortcutEditorRow.tsx';
import { handleWorkspaceKeyboard, matchAudioEditorShortcut } from '../src/common/editor/ui/workspace-shortcuts.ts';

for (const [binding, key, code] of [['Shift+<', '<', 'Comma'], ['Shift+>', '>', 'Period']] as const) {
	test(`the accepted ${binding} preference owns its printed key before an earlier base-key alias`, () => {
		const preferences = createAudioEditorPreferencesV1();
		const draft = shortcutEditorDraft({ shortcuts: preferences.shortcuts, preferenceId: 'new-label-track', bindings: [binding] });
		assert.equal(draft.invalid, false);
		assert.equal(draft.conflict, null);
		const shortcuts = { ...preferences.shortcuts, 'new-label-track': draft.bindings };
		const event = { key, code, ctrlKey: false, altKey: false, metaKey: false, shiftKey: true,
			target: null, defaultPrevented: false, preventDefault() {} };
		const performed: string[] = [];
		handleWorkspaceKeyboard(event, { preferences: { shortcuts } }, work => work(), { menus: [
			{ id: 'cursor-long-jump-left', onClick: () => { performed.push('jump-left'); } },
			{ id: 'cursor-long-jump-right', onClick: () => { performed.push('jump-right'); } },
			{ id: 'new-label-track', onClick: () => { performed.push('new-label-track'); } },
		] });
		assert.deepEqual(performed, ['new-label-track']);
		assert.equal(matchAudioEditorShortcut(event, preferences.shortcuts), key === '<' ? 'cursor-long-jump-left' : 'cursor-long-jump-right',
			'the established base-key shortcut still works when nobody assigned the printed character');
	});
}
