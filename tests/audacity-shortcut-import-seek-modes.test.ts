/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAudacityShortcutImport } from '../src/common/editor/audacity-shortcut-import.ts';
import { AUDACITY_SHORTCUT_PROFILE, AUDACITY_SHORTCUT_BINDINGS_BY_ACTION } from '../src/common/editor/audacity-shortcut-profile.ts';

for (const [legacy, command, target] of [
	[true, 'SeekLeftLong', 'track-view-item-extend-left'],
	[true, 'SeekRightLong', 'track-view-item-extend-right'],
	[false, 'seek-left-long', 'track-view-item-extend-left'],
	[false, 'seek-right-long', 'track-view-item-extend-right'],
] as const) test(`busy-only ${command} cannot replace a selection adjustment with an unrelated seek`, () => {
	const current = { [target]: ['Shift+Left'], 'cursor-long-jump-left': ['Shift+,'], 'cursor-long-jump-right': ['Shift+.'] };
	const commandXml = legacy ? `<audacitykeyboard audacityversion="3.7.7"><command name="${command}" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>`
		: `<Shortcuts><SC><key>${command}</key><seq>Ctrl+Alt+Shift+F7</seq></SC></Shortcuts>`;
	const plan = parseAudacityShortcutImport(commandXml, current, { availableActionIds: Object.keys(current) });
	assert.equal(plan.importedCount, 0);
	assert.deepEqual(plan.skipped, [{ command, reason: 'unsupported-command' }]);
	assert.deepEqual(plan.shortcuts, current);
});

test('ordinary selection, one-second seeks and explicit all-state cursor jumps remain independent', () => {
	const plan = parseAudacityShortcutImport(`<audacitykeyboard audacityversion="3.7.7">
		<command name="SeekRightShort" key="Ctrl+F7"/><command name="SeekLeftShort" key="Ctrl+F8"/>
		<command name="SelExtRight" key="Ctrl+F10"/>
	</audacitykeyboard>`, {});
	assert.equal(plan.importedCount, 3);
	assert.deepEqual(plan.skipped, []);
	assert.deepEqual(plan.shortcuts, { 'play-position-increase': ['Ctrl+F7'], 'play-position-decrease': ['Ctrl+F8'],
		'track-view-item-extend-right': ['Ctrl+F10'] });
	const modern = parseAudacityShortcutImport('<Shortcuts><SC><key>cursor-long-jump-right</key><seq>Ctrl+F9</seq></SC></Shortcuts>', {});
	assert.equal(modern.importedCount, 1);
	assert.deepEqual(modern.skipped, []);
	assert.deepEqual(modern.shortcuts, { 'cursor-long-jump-right': ['Ctrl+F9'] });
});

test('the native long-seek profile is truthful without removing ordinary editor selection keys', () => {
	for (const id of ['seek-left-long', 'seek-right-long']) {
		const entry = AUDACITY_SHORTCUT_PROFILE.find(value => value.upstreamActionId === id); assert.ok(entry);
		assert.equal(entry.disposition, 'unavailable');
		assert.equal(entry.reason, 'unsupported');
	}
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['track-view-item-extend-left'], ['Shift+Left']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['track-view-item-extend-right'], ['Shift+Right']);
	assert.deepEqual(AUDACITY_SHORTCUT_BINDINGS_BY_ACTION['cursor-long-jump-left'], ['Shift+,']);
});
