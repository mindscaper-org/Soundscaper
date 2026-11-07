/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAudacityShortcutImport } from '../src/common/editor/audacity-shortcut-import.ts';
import { audioEditorPrimaryShortcut } from '../src/common/editor/audacity-shortcut-bindings.ts';
import { importShortcutPreferences } from './helpers/shortcut-import-custody.ts';

for (const command of ['SelTrackStartToCursor', 'SelCursorToTrackEnd']) {
	test(`native ${command} cannot import as a playhead-anchored replacement of both endpoints`, () => {
		const current = { 'select-track-start-to-cursor': ['Shift+J'], 'select-cursor-to-track-end': ['Shift+K'] };
		const plan = parseAudacityShortcutImport(`<audacitykeyboard audacityversion="3.7.7"><command name="${command}" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>`, current,
			{ availableActionIds: Object.keys(current) });
		assert.equal(plan.importedCount, 0);
		assert.deepEqual(plan.skipped, [{ command, reason: 'unsupported-command' }]);
		assert.deepEqual(plan.shortcuts, current);
	});
}

test('native whole-track selection remains an exact supported counterpart', () => {
	const plan = parseAudacityShortcutImport('<audacitykeyboard audacityversion="3.7.7"><command name="SelTrackStartToEnd" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>', {});
	assert.equal(plan.importedCount, 1);
	assert.deepEqual(plan.skipped, []);
	assert.deepEqual(plan.shortcuts, { 'select-track-start-to-end': ['Ctrl+Alt+Shift+F7'] });
});

for (const command of ['SelTrackStartToCursor', 'SelCursorToTrackEnd']) test(`${command} review cannot persist a replacement endpoint binding`, async context => {
	const current = { 'select-track-start-to-cursor': ['Shift+J'], 'select-cursor-to-track-end': ['Shift+K'] };
	const { plan, before, persisted, saves } = await importShortcutPreferences(context,
		`<audacitykeyboard><command name="${command}" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>`, current);
	assert.equal(plan.importedCount, 0); assert.deepEqual(plan.skipped, [{ command, reason: 'unsupported-command' }]);
	assert.equal(saves, 0); assert.deepEqual(persisted, before);
});

test('modern endpoint bindings reach durable preferences through the import session', async context => {
	const { plan, persisted, saves } = await importShortcutPreferences(context,
		'<Shortcuts><SC><key>track-start-cursor</key><seq>Ctrl+F7</seq></SC><SC><key>cursor-track-end</key><seq>Ctrl+F8</seq></SC></Shortcuts>',
		{ 'select-track-start-to-cursor': ['Shift+J'], 'select-cursor-to-track-end': ['Shift+K'] });
	assert.equal(plan.importedCount, 2); assert.equal(saves, 1);
	assert.deepEqual(persisted['select-track-start-to-cursor'], ['Ctrl+F7']);
	assert.deepEqual(persisted['select-cursor-to-track-end'], ['Ctrl+F8']);
});

test('modern and local playhead-anchored selections keep their established bindings', () => {
	const plan = parseAudacityShortcutImport('<Shortcuts><SC><key>track-start-cursor</key><seq>Ctrl+F7</seq></SC><SC><key>cursor-track-end</key><seq>Ctrl+F8</seq></SC></Shortcuts>', {});
	assert.equal(plan.importedCount, 2);
	assert.deepEqual(plan.skipped, []);
	assert.deepEqual(plan.shortcuts, { 'select-track-start-to-cursor': ['Ctrl+F7'], 'select-cursor-to-track-end': ['Ctrl+F8'] });
	assert.equal(audioEditorPrimaryShortcut('select-track-start-to-cursor'), 'Shift+J');
	assert.equal(audioEditorPrimaryShortcut('select-cursor-to-track-end'), 'Shift+K');
});
