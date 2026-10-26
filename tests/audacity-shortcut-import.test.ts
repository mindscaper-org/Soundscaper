/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDACITY_SHORTCUT_IMPORT_MAX_BYTES,
	parseAudacityShortcutImport,
} from '../src/common/editor/audacity-shortcut-import.ts';

const availableActionIds = [
	'file-new', 'file-open', 'action://trackedit/undo', 'new-mono-track', 'zoom-in',
	'new-label-track', 'label-add', 'track-view-next-panel', 'action://delete',
];
const options = { availableActionIds };

test('Audacity 3 imports stable command names, preserving unrelated shortcuts and caller data', () => {
	const current = { 'file-open': ['Ctrl+O'], 'new-mono-track': ['M'] };
	const plan = parseAudacityShortcutImport(`<audacitykeyboard audacityversion="3.7.7">
		<command name="NewMonoTrack" key="Alt+Shift+N"/>
		<command name="Undo" key="Shift+Ctrl+Z"/>
		<command name="ZoomIn" key="Ctrl++"/>
	</audacitykeyboard>`, current, options);
	assert.equal(plan.format, 'audacity-3');
	assert.equal(plan.importedCount, 3);
	assert.deepEqual(plan.shortcuts, {
		'file-open': ['Ctrl+O'], 'new-mono-track': ['Alt+Shift+N'],
		'action://trackedit/undo': ['Ctrl+Shift+Z'], 'zoom-in': ['Ctrl++'],
	});
	assert.deepEqual(current, { 'file-open': ['Ctrl+O'], 'new-mono-track': ['M'] });
	assert.deepEqual(plan.skipped, []);
});

test('Audacity 4 combines multiple sequences and contextual aliases for one command', () => {
	const plan = parseAudacityShortcutImport(`<Shortcuts>
		<SC><key>nav-next-section</key><seq>F6</seq><seq>\`</seq><autorepeat>0</autorepeat></SC>
		<SC><key>track-view-next-panel</key><seq>Tab</seq></SC>
		<SC><key>new-mono-track</key><seq>Ctrl+Shift+N</seq><seq>Ctrl+Shift+N</seq></SC>
	</Shortcuts>`, {}, options);
	assert.equal(plan.format, 'audacity-4');
	assert.equal(plan.importedCount, 2);
	assert.deepEqual(plan.shortcuts['track-view-next-panel'], ['F6', '`', 'Tab']);
	assert.deepEqual(plan.shortcuts['new-mono-track'], ['Ctrl+Shift+N']);
});

test('explicit empty bindings clear the mapped command and empty aliases preserve its assignments', () => {
	const v3 = parseAudacityShortcutImport('<audacitykeyboard><command name="NewMonoTrack" key=""/></audacitykeyboard>',
		{ 'new-mono-track': ['N'], 'file-open': ['Ctrl+O'] }, options);
	assert.equal(v3.importedCount, 1);
	assert.deepEqual(v3.shortcuts, { 'new-mono-track': [], 'file-open': ['Ctrl+O'] });
	const v4 = parseAudacityShortcutImport(`<Shortcuts>
		<SC><key>label-add</key><seq>Ctrl+B</seq></SC><SC><key>add-label-playing</key></SC>
		<SC><key>new-mono-track</key><seq/></SC>
	</Shortcuts>`, { 'new-mono-track': ['N'] }, options);
	assert.deepEqual(v4.shortcuts, { 'label-add': ['Ctrl+B'], 'new-mono-track': [] });
});

test('imported chords displace existing bindings and report the number removed', () => {
	const plan = parseAudacityShortcutImport('<audacitykeyboard><command name="NewMonoTrack" key="Ctrl+O"/></audacitykeyboard>',
		{ 'file-open': ['Meta+O', 'Alt+O'], 'new-label-track': ['Ctrl+O'] }, options);
	assert.deepEqual(plan.shortcuts, {
		'file-open': ['Alt+O'], 'new-label-track': [], 'new-mono-track': ['Ctrl+O'],
	});
	assert.equal(plan.reassignedCount, 2);
});

test('first imported owner keeps a duplicate chord and conflicting later rows are reported', () => {
	const plan = parseAudacityShortcutImport(`<Shortcuts>
		<SC><key>new-mono-track</key><seq>Ctrl+N</seq></SC>
		<SC><key>new-label-track</key><seq>ctrl+n</seq><seq>Alt+N</seq></SC>
	</Shortcuts>`, {}, options);
	assert.deepEqual(plan.shortcuts, { 'new-mono-track': ['Ctrl+N'], 'new-label-track': ['Alt+N'] });
	assert.deepEqual(plan.skipped, [{ command: 'new-label-track', binding: 'ctrl+n', reason: 'duplicate-shortcut' }]);
});

test('unsupported commands, invalid keys and reserved chords are skipped without clearing their current bindings', () => {
	const current = { 'new-mono-track': ['N'], 'file-open': ['Ctrl+O'] };
	const plan = parseAudacityShortcutImport(`<Shortcuts>
		<SC><key>unknown-plugin</key><seq>Alt+P</seq></SC>
		<SC><key>file-open</key><seq>Ctrl+Backspacee</seq><seq>Ctrl+K</seq></SC>
		<SC><key>new-mono-track</key><seq>Ctrl+Bogus+N</seq></SC>
	</Shortcuts>`, current, options);
	assert.equal(plan.importedCount, 0);
	assert.deepEqual(plan.shortcuts, current);
	assert.deepEqual(plan.skipped.map(({ reason }) => reason), [
		'unsupported-command', 'invalid-shortcut', 'reserved-shortcut', 'invalid-shortcut',
	]);
});

test('product capabilities and reserved binding callbacks limit an import', () => {
	const plan = parseAudacityShortcutImport(`<Shortcuts>
		<SC><key>new-mono-track</key><seq>M</seq></SC>
		<SC><key>file-open</key><seq>F6</seq></SC>
	</Shortcuts>`, {}, {
		availableActionIds: ['file-open'], isReservedBinding: (binding) => binding === 'F6',
	});
	assert.equal(plan.importedCount, 0);
	assert.deepEqual(plan.skipped.map(({ reason }) => reason), ['unsupported-command', 'reserved-shortcut']);
});

test('reserved shortcut maps protect extra application commands', () => {
	const plan = parseAudacityShortcutImport('<audacitykeyboard><command name="NewMonoTrack" key="Ctrl+P"/></audacitykeyboard>',
		{}, { ...options, reservedShortcuts: { print: ['Meta+P'] } });
	assert.equal(plan.importedCount, 0);
	assert.equal(plan.skipped[0]?.reason, 'reserved-shortcut');
});

test('Audacity legacy key aliases normalize to browser keys', () => {
	const plan = parseAudacityShortcutImport(`<Shortcuts>
		<SC><key>action://delete</key><seq>Del</seq><seq>delete</seq><seq>NUMPAD_ENTER</seq><seq>PgUp</seq></SC>
	</Shortcuts>`, {}, options);
	assert.deepEqual(plan.shortcuts['action://delete'], ['Delete', 'NumpadEnter', 'PageUp']);
});

test('legacy transport commands preserve distinct pause and default play-stop actions', () => {
	const plan = parseAudacityShortcutImport(`<audacitykeyboard>
		<command name="Pause" key="P"/><command name="DefaultPlayStop" key="Space"/>
	</audacitykeyboard>`, {}, {
		availableActionIds: ['action://playback/pause', 'action://playback/toggle-play-stop'],
	});
	assert.deepEqual(plan.shortcuts, {
		'action://playback/pause': ['P'], 'action://playback/toggle-play-stop': ['Space'],
	});
});

test('legacy macOS primary aliases import and physical Control entries are reported', () => {
	const plan = parseAudacityShortcutImport(`<audacitykeyboard>
		<command name="NewMonoTrack" key="Command+Option+N"/>
		<command name="NewLabelTrack" key="RawCtrl+L"/>
		<command name="Open" key="Control+O"/>
	</audacitykeyboard>`, {}, options);
	assert.deepEqual(plan.shortcuts, { 'new-mono-track': ['Ctrl+Alt+N'] });
	assert.equal(plan.skipped.length, 2);
	assert.ok(plan.skipped.every(({ reason }) => reason === 'invalid-shortcut'));
});

test('platform standard-key records without concrete sequences do not clear current shortcuts', () => {
	const current = { 'file-open': ['Ctrl+O'] };
	const plan = parseAudacityShortcutImport('<Shortcuts><SC><key>file-open</key><std>3</std></SC></Shortcuts>',
		current, options);
	assert.equal(plan.importedCount, 0);
	assert.deepEqual(plan.shortcuts, current);
	assert.deepEqual(plan.skipped, [{ command: 'file-open', reason: 'invalid-shortcut' }]);
});

test('ambiguous Qt Meta and multi-step sequences are reported without changing their commands', () => {
	const current = { 'file-open': ['Ctrl+O'], 'new-mono-track': ['N'] };
	const plan = parseAudacityShortcutImport(`<Shortcuts>
		<SC><key>file-open</key><seq>Meta+O</seq></SC>
		<SC><key>new-mono-track</key><seq>Ctrl+X, Ctrl+N</seq></SC>
	</Shortcuts>`, current, options);
	assert.equal(plan.importedCount, 0);
	assert.deepEqual(plan.shortcuts, current);
	assert.ok(plan.skipped.every(({ reason }) => reason === 'invalid-shortcut'));
});

test('malformed, unrelated, entity-bearing and recordless XML is rejected', () => {
	for (const xml of ['<Shortcuts>', '<html/>', '<Shortcuts/>',
		'<!DOCTYPE Shortcuts [<!ENTITY injected "N">]><Shortcuts><SC><key>file-new</key><seq>&injected;</seq></SC></Shortcuts>',
		'<Shortcuts><SC><key>file-new</key><key>file-open</key><seq>N</seq></SC></Shortcuts>',
		'<audacitykeyboard><command name="New"/></audacitykeyboard>']) {
		assert.throws(() => parseAudacityShortcutImport(xml, {}, options), /XML|shortcut|command|document|doctype/iu, xml);
	}
});

test('shortcut XML caps byte length and tree depth before applying any change', () => {
	assert.throws(() => parseAudacityShortcutImport(' '.repeat(AUDACITY_SHORTCUT_IMPORT_MAX_BYTES + 1), {}), /limit/iu);
	assert.throws(() => parseAudacityShortcutImport(`<Shortcuts>${'<SC>'.repeat(9)}${'</SC>'.repeat(9)}</Shortcuts>`, {}), /levels/iu);
});
