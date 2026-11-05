/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAudacityShortcutImport } from '../src/common/editor/audacity-shortcut-import.ts';
import { audioEditorPrimaryShortcut } from '../src/common/editor/audacity-shortcut-bindings.ts';

const targets = ['play-position-decrease', 'play-position-increase', 'cursor-short-jump-left', 'cursor-short-jump-right', 'cursor-long-jump-left', 'cursor-long-jump-right'];
for (const command of ['CursorLeft', 'CursorRight', 'CursorShortJumpLeft', 'CursorShortJumpRight', 'CursorLongJumpLeft', 'CursorLongJumpRight']) {
	test(`native ${command} cannot import as a step that skips its stopped range-collapse behavior`, () => {
		const current = Object.fromEntries(targets.map(target => [target, [audioEditorPrimaryShortcut(target) ?? 'Left']]));
		const plan = parseAudacityShortcutImport(`<audacitykeyboard audacityversion="3.7.7"><command name="${command}" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>`, current,
			{ availableActionIds: targets });
		assert.equal(plan.importedCount, 0);
		assert.deepEqual(plan.skipped, [{ command, reason: 'unsupported-command' }]);
		assert.deepEqual(plan.shortcuts, current);
	});
}

test('modern and local timed cursor actions retain their independent behavior and default bindings', () => {
	const plan = parseAudacityShortcutImport('<Shortcuts>' + targets.map((target, index) => `<SC><key>${target}</key><seq>Ctrl+F${index + 7}</seq></SC>`).join('') + '</Shortcuts>', {},
		{ availableActionIds: targets });
	assert.equal(plan.importedCount, targets.length);
	assert.deepEqual(plan.skipped, []);
	assert.deepEqual(plan.shortcuts, Object.fromEntries(targets.map((target, index) => [target, [`Ctrl+F${index + 7}`]])));
	assert.equal(audioEditorPrimaryShortcut('play-position-decrease'), 'Left');
	assert.equal(audioEditorPrimaryShortcut('play-position-increase'), 'Right');
	assert.equal(audioEditorPrimaryShortcut('cursor-long-jump-right'), 'Shift+.');
});
