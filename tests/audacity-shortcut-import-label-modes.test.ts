/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAudacityShortcutImport } from '../src/common/editor/audacity-shortcut-import.ts';
import { audioEditorPrimaryShortcut } from '../src/common/editor/audacity-shortcut-bindings.ts';

for (const command of ['AddLabel', 'AddLabelPlaying']) {
	test(`native ${command} cannot import as the contextual local label command`, () => {
		const current = { 'label-add': ['Ctrl+B', 'Ctrl+.'] };
		const plan = parseAudacityShortcutImport(`<audacitykeyboard audacityversion="3.7.7"><command name="${command}" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>`, current,
			{ availableActionIds: ['label-add'] });
		assert.equal(plan.importedCount, 0);
		assert.deepEqual(plan.skipped, [{ command, reason: 'unsupported-command' }]);
		assert.deepEqual(plan.shortcuts, current);
	});
}

test('modern label commands retain the established local stopped and live behavior', () => {
	const plan = parseAudacityShortcutImport('<Shortcuts><SC><key>label-add</key><seq>Ctrl+F7</seq></SC><SC><key>add-label-playing</key><seq>Ctrl+F8</seq></SC></Shortcuts>', {});
	assert.equal(plan.importedCount, 1);
	assert.deepEqual(plan.skipped, []);
	assert.deepEqual(plan.shortcuts, { 'label-add': ['Ctrl+F7', 'Ctrl+F8'] });
	assert.equal(audioEditorPrimaryShortcut('label-add'), 'Ctrl+B');
});
