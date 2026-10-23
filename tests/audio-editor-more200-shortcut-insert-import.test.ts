/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAudacityShortcutImport } from '../src/common/editor/audacity-shortcut-import.ts';
import { audioEditorShortcutConflictKey } from '../src/common/editor/audio-editor-shortcut-normalization.ts';

// Qt's maintained PortableText serializer spells Qt::Key_Insert "Ins".
// https://github.com/qt/qtbase/blob/6.8/src/gui/kernel/qkeysequence.cpp
for (const binding of ['Ins', 'Alt+Ins', 'Ctrl+Shift+Ins', 'Alt+Insert']) {
	test(`Audacity shortcut file retains the supported Insert key from ${binding}`, () => {
		const plan = parseAudacityShortcutImport(`<Shortcuts><SC><key>new-mono-track</key><seq>${binding}</seq></SC></Shortcuts>`,
			{ 'new-mono-track': ['Ctrl+Shift+N'] }, { availableActionIds: ['new-mono-track'] });
		assert.equal(plan.importedCount, 1); assert.deepEqual(plan.skipped, []);
		assert.deepEqual(plan.shortcuts['new-mono-track'], [binding.replace(/Ins$/u, 'Insert')]);
		assert.equal(audioEditorShortcutConflictKey(plan.shortcuts['new-mono-track']![0]!),
			audioEditorShortcutConflictKey(binding.replace(/Ins$/u, 'Insert')));
	});
}

test('Insert file spelling preserves shortcut reassignment and typographical-key refusal', () => {
	const plan = parseAudacityShortcutImport(`<Shortcuts>
		<SC><key>new-mono-track</key><seq>Alt+Ins</seq></SC>
		<SC><key>file-open</key><seq>Alt+Insert</seq><seq>Ctrl+Insertx</seq></SC>
	</Shortcuts>`, { 'file-open': ['Alt+Insert', 'Ctrl+O'] }, { availableActionIds: ['new-mono-track', 'file-open'] });
	assert.deepEqual(plan.shortcuts, { 'new-mono-track': ['Alt+Insert'], 'file-open': ['Ctrl+O'] });
	assert.equal(plan.reassignedCount, 1);
	assert.deepEqual(plan.skipped.map(entry => entry.reason), ['duplicate-shortcut', 'invalid-shortcut']);
});
