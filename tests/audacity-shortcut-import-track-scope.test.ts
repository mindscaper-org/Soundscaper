/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAudacityShortcutImport } from '../src/common/editor/audacity-shortcut-import.ts';
import { AUDACITY_SHORTCUT_PROFILE } from '../src/common/editor/audacity-shortcut-profile.ts';
import { audacityPrimaryShortcut, audioEditorPrimaryShortcut } from '../src/common/editor/audacity-shortcut-bindings.ts';
import { importShortcutPreferences } from './helpers/shortcut-import-custody.ts';

for (const [command, xml] of [
	['TrackClose', '<audacitykeyboard audacityversion="3.7.7"><command name="TrackClose" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>'],
	['track-close', '<Shortcuts><SC><key>track-close</key><seq>Ctrl+Alt+Shift+F7</seq></SC></Shortcuts>'],
] as const) test(`${command} cannot import as removal of the complete track selection`, () => {
	const current = { 'remove-tracks': ['Shift+C'] };
	const plan = parseAudacityShortcutImport(xml, current, { availableActionIds: ['remove-tracks'] });
	assert.equal(plan.importedCount, 0);
	assert.deepEqual(plan.skipped, [{ command, reason: 'unsupported-command' }]);
	assert.deepEqual(plan.shortcuts, current);
});

test('the native remove-selected command still imports independently', () => {
	const plan = parseAudacityShortcutImport('<audacitykeyboard audacityversion="3.7.7"><command name="RemoveTracks" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>', {});
	assert.equal(plan.importedCount, 1);
	assert.deepEqual(plan.skipped, []);
	assert.deepEqual(plan.shortcuts, { 'remove-tracks': ['Ctrl+Alt+Shift+F7'] });
});

test('the source focused-track command is unsupported while the editor retains its plural removal key', () => {
	const entry = AUDACITY_SHORTCUT_PROFILE.find(value => value.upstreamActionId === 'track-close'); assert.ok(entry);
	assert.equal(entry.disposition, 'unavailable');
	assert.equal(entry.reason, 'unsupported');
	assert.equal(audacityPrimaryShortcut('remove-tracks'), null);
	assert.equal(audioEditorPrimaryShortcut('remove-tracks'), 'Shift+C');
});

for (const [command, xml] of [
	['TrackClose', '<audacitykeyboard><command name="TrackClose" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>'],
	['track-close', '<Shortcuts><SC><key>track-close</key><seq>Ctrl+Alt+Shift+F7</seq></SC></Shortcuts>'],
] as const) test(`${command} review leaves the durable selected-track removal binding intact`, async context => {
	const { plan, before, persisted, saves } = await importShortcutPreferences(context, xml, { 'remove-tracks': ['Shift+C'] });
	assert.deepEqual(plan.skipped, [{ command, reason: 'unsupported-command' }]);
	assert.equal(plan.importedCount, 0); assert.equal(saves, 0); assert.deepEqual(persisted, before);
});

test('native RemoveTracks persists only the supported selected-track command', async context => {
	const { plan, persisted, saves } = await importShortcutPreferences(context,
		'<audacitykeyboard><command name="RemoveTracks" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>', { 'remove-tracks': ['Shift+C'] });
	assert.equal(plan.importedCount, 1); assert.equal(saves, 1);
	assert.deepEqual(persisted['remove-tracks'], ['Ctrl+Alt+Shift+F7']);
});
