/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAudacityShortcutImport } from '../src/common/editor/audacity-shortcut-import.ts';
import { AUDACITY_SHORTCUT_PROFILE, AUDACITY_SHORTCUT_DISPOSITION } from '../src/common/editor/audacity-shortcut-profile.ts';
import { audacityPrimaryShortcut, audioEditorPrimaryShortcut } from '../src/common/editor/audacity-shortcut-bindings.ts';
import { importShortcutPreferences } from './helpers/shortcut-import-custody.ts';

for (const [format, command, xml] of [
	['Audacity3', 'MixAndRenderToNewTrack', '<audacitykeyboard audacityversion="3.7.7"><command name="MixAndRenderToNewTrack" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>'],
	['Audacity4', 'mix-and-render-to-new-track', '<Shortcuts><SC><key>mix-and-render-to-new-track</key><seq>Ctrl+Alt+Shift+F7</seq></SC></Shortcuts>'],
] as const) test(`${format} new-track rendering cannot replace the ordinary mix shortcut`, () => {
	const current = { 'mix-render': ['Ctrl+M'] };
	const plan = parseAudacityShortcutImport(xml, current, { availableActionIds: ['mix-render'] });
	assert.equal(plan.importedCount, 0);
	assert.deepEqual(plan.skipped, [{ command, reason: 'unsupported-command' }]);
	assert.deepEqual(plan.shortcuts, current);
});

test('ordinary Audacity MixAndRender still imports as the existing mix command', () => {
	const plan = parseAudacityShortcutImport('<audacitykeyboard><command name="MixAndRender" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>',
		{}, { availableActionIds: ['mix-render'] });
	assert.equal(plan.importedCount, 1);
	assert.deepEqual(plan.skipped, []);
	assert.deepEqual(plan.shortcuts, { 'mix-render': ['Ctrl+Alt+Shift+F7'] });
});

test('the Audacity new-track source record is unavailable while the editor retains its own mix shortcut', () => {
	const entry = AUDACITY_SHORTCUT_PROFILE.find(record => record.upstreamActionId === 'mix-and-render-to-new-track');
	assert.equal(entry?.disposition, AUDACITY_SHORTCUT_DISPOSITION.UNAVAILABLE);
	assert.equal(entry?.reason, 'unsupported');
	assert.equal(audacityPrimaryShortcut('mix-render'), null);
	assert.equal(audioEditorPrimaryShortcut('mix-render'), 'Ctrl+Shift+M');
});

for (const [command, xml] of [
	['MixAndRenderToNewTrack', '<audacitykeyboard><command name="MixAndRenderToNewTrack" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>'],
	['mix-and-render-to-new-track', '<Shortcuts><SC><key>mix-and-render-to-new-track</key><seq>Ctrl+Alt+Shift+F7</seq></SC></Shortcuts>'],
] as const) test(`${command} review cannot persist a different mix operation`, async context => {
	const { plan, before, persisted, saves } = await importShortcutPreferences(context, xml, { 'mix-render': ['Ctrl+M'] });
	assert.deepEqual(plan.skipped, [{ command, reason: 'unsupported-command' }]);
	assert.equal(plan.importedCount, 0); assert.equal(saves, 0); assert.deepEqual(persisted, before);
});

test('native MixAndRender reaches the durable ordinary mix binding', async context => {
	const { plan, persisted, saves } = await importShortcutPreferences(context,
		'<audacitykeyboard><command name="MixAndRender" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>', { 'mix-render': ['Ctrl+M'] });
	assert.equal(plan.importedCount, 1); assert.equal(saves, 1);
	assert.deepEqual(persisted['mix-render'], ['Ctrl+Alt+Shift+F7']);
});
