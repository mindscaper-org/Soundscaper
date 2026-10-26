/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDACITY_SHORTCUT_IMPORT_MAX_BYTES, parseAudacityShortcutImport } from '../src/common/editor/audacity-shortcut-import.ts';
import { largeAudacityShortcutXml } from './helpers/audacity-large-shortcut-fixture.ts';

for (const formatted of [false, true]) test(`a full Audacity keymap ignores unavailable commands with indentation=${String(formatted)}`, () => {
	const xml = largeAudacityShortcutXml(formatted);
	assert.ok(Buffer.byteLength(xml) < AUDACITY_SHORTCUT_IMPORT_MAX_BYTES / 4);
	const plan = parseAudacityShortcutImport(xml, { 'file-open': ['Ctrl+O'] }, { availableActionIds: ['new-mono-track'] });
	assert.equal(plan.importedCount, 1); assert.equal(plan.skipped.length, 900);
	assert.ok(plan.skipped.every(entry => entry.reason === 'unsupported-command'));
	assert.deepEqual(plan.shortcuts, { 'file-open': ['Ctrl+O'], 'new-mono-track': ['Alt+F10'] });
	assert.deepEqual(plan, parseAudacityShortcutImport(largeAudacityShortcutXml(false),
		{ 'file-open': ['Ctrl+O'] }, { availableActionIds: ['new-mono-track'] }));
});

for (const field of ['key', 'seq']) test(`shortcut XML retains the 4KiB meaningful ${field} limit`, () => {
	const value = 'é'.repeat(2049);
	const xml = `<Shortcuts><SC><key>${field === 'key' ? value : 'new-mono-track'}</key><seq>${field === 'seq' ? value : 'Alt+F10'}</seq></SC></Shortcuts>`;
	assert.throws(() => parseAudacityShortcutImport(xml, {}), /4096|4\s?KiB/u);
});
