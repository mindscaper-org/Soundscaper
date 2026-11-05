/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAudacityShortcutImport } from '../src/common/editor/audacity-shortcut-import.ts';

for (const [command, target] of [
	['Cut', 'cut-per-track-ripple'], ['Delete', 'delete-per-track-ripple'],
	['DeleteKey', 'delete-per-track-ripple'], ['DeleteKey2', 'delete-per-track-ripple'],
] as const) test(`native legacy ${command} keeps its fixed selected-track close-gap behavior`, () => {
	const current = { 'action://cut': ['Ctrl+X'], 'action://delete': ['Delete'],
		'cut-per-track-ripple': ['Shift+X'], 'delete-per-track-ripple': ['Shift+Delete'] };
	const plan = parseAudacityShortcutImport(`<audacitykeyboard audacityversion="3.7.7"><command name="${command}" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>`, current,
		{ availableActionIds: Object.keys(current) });
	assert.equal(plan.importedCount, 1);
	assert.deepEqual(plan.skipped, []);
	assert.deepEqual(plan.shortcuts, { ...current, [target]: ['Ctrl+Alt+Shift+F7'] });
});

test('legacy split cut and split delete retain their independent leave-gap behavior', () => {
	const plan = parseAudacityShortcutImport('<audacitykeyboard audacityversion="3.7.7"><command name="SplitCut" key="Ctrl+F7"/><command name="SplitDelete" key="Ctrl+F8"/></audacitykeyboard>', {});
	assert.equal(plan.importedCount, 2);
	assert.deepEqual(plan.skipped, []);
	assert.deepEqual(plan.shortcuts, { 'cut-leave-gap': ['Ctrl+F7'], 'delete-leave-gap': ['Ctrl+F8'] });
});

test('modern generic Cut and Delete continue using the editor preference-driven actions', () => {
	const plan = parseAudacityShortcutImport('<Shortcuts><SC><key>action://cut</key><seq>Ctrl+F7</seq></SC><SC><key>action://delete</key><seq>Ctrl+F8</seq></SC></Shortcuts>', {});
	assert.equal(plan.importedCount, 2);
	assert.deepEqual(plan.skipped, []);
	assert.deepEqual(plan.shortcuts, { 'action://cut': ['Ctrl+F7'], 'action://delete': ['Ctrl+F8'] });
});
