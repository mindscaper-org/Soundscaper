/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles, waitForEditor } from './audio-editor-test-helpers.js';

const EXPORTS = [
	{
		version: 3,
		bindings: ['Ctrl+Alt+Shift+F6'],
		keys: ['Control+Alt+Shift+F6'],
		xml: `<?xml version="1.0" encoding="UTF-8"?>
<audacitykeyboard audacityversion="3.7.7">
	<command name="NewMonoTrack" key="Ctrl+Alt+Shift+F6"/>
	<command name="FutureAudacityCommand" key="Ctrl+Alt+Shift+F7"/>
</audacitykeyboard>`,
	},
	{
		version: 4,
		bindings: ['Ctrl+Alt+Shift+F8', 'Ctrl+Alt+Shift+F9'],
		keys: ['Control+Alt+Shift+F8', 'Control+Alt+Shift+F9'],
		xml: `<?xml version="1.0" encoding="UTF-8"?>
<Shortcuts>
	<SC><key>new-mono-track</key><seq>Ctrl+Alt+Shift+F8</seq><seq>Ctrl+Alt+Shift+F9</seq></SC>
	<SC><key>future-audacity-command</key><seq>Ctrl+Alt+Shift+F7</seq></SC>
</Shortcuts>`,
	},
];

test('reviews both Audacity shortcut dialects and keeps their applied bindings after reload', async ({ page }) => {
	let editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	for (const exported of EXPORTS) {
		let preferences = await openShortcutPreferences(page, editor);
		let mono = await shortcutCommand(preferences, 'New mono track');
		const original = await mono.getByRole('textbox').first().inputValue();
		const label = await shortcutCommand(preferences, 'New label track');
		const originalLabel = await label.getByRole('textbox').first().inputValue();
		await chooseShortcutExport(page, preferences, exported.xml, `audacity-${exported.version}-shortcuts.xml`);

		const review = preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true });
		await expect(review.getByRole('status')).toContainText('1 command');
		await expect(review.getByRole('status')).toContainText('1 skipped');
		await review.getByText('Review shortcut changes', { exact: true }).click();
		await expect(review.getByRole('listitem').filter({ hasText: 'New mono track:' }))
			.toContainText(exported.bindings.join(', '));
		await review.getByText('Skipped shortcuts', { exact: true }).click();
		await expect(review.getByRole('listitem').filter({ hasText: 'Command unavailable' }))
			.toContainText(exported.version === 3 ? 'FutureAudacityCommand' : 'future-audacity-command');
		mono = await shortcutCommand(preferences, 'New mono track');
		await expect(mono.getByRole('textbox').first()).toHaveValue(original);
		await review.getByRole('button', { name: 'Apply shortcuts', exact: true }).click();
		await expect(preferences.getByRole('status').filter({ hasText: 'Imported 1 command.' })).toBeVisible();
		await expect(mono.getByRole('textbox')).toHaveCount(exported.bindings.length);
		for (const [index, binding] of exported.bindings.entries()) {
			await expect(mono.getByRole('textbox').nth(index)).toHaveValue(binding);
		}
		await expect((await shortcutCommand(preferences, 'New label track')).getByRole('textbox').first()).toHaveValue(originalLabel);
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		const tracks = editor.getByRole('group', { name: /, audio track$/u });
		const initialTracks = await tracks.count();
		await editor.getByRole('group', { name: 'Playhead', exact: true }).focus();
		for (const [index, key] of exported.keys.entries()) {
			await page.keyboard.press(key);
			await expect(tracks).toHaveCount(initialTracks + index + 1);
		}

		await page.reload();
		editor = await waitForEditor(page);
		preferences = await openShortcutPreferences(page, editor);
		mono = await shortcutCommand(preferences, 'New mono track');
		await expect(mono.getByRole('textbox')).toHaveCount(exported.bindings.length);
		for (const [index, binding] of exported.bindings.entries()) {
			await expect(mono.getByRole('textbox').nth(index)).toHaveValue(binding);
		}
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	}
});

test('canceling a shortcut import leaves the existing bindings unchanged', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const preferences = await openShortcutPreferences(page, editor);
	const mono = await shortcutCommand(preferences, 'New mono track');
	const original = await mono.getByRole('textbox').first().inputValue();
	await chooseShortcutExport(page, preferences, EXPORTS[0].xml);
	const review = preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true });
	await expect(review.getByRole('button', { name: 'Apply shortcuts', exact: true })).toBeEnabled();
	await review.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(review.getByRole('button', { name: 'Apply shortcuts', exact: true })).toHaveCount(0);
	await expect(mono.getByRole('textbox').first()).toHaveValue(original);
});

test('malformed shortcut XML reports an error and preserves the saved shortcut', async ({ page }) => {
	let editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	let preferences = await openShortcutPreferences(page, editor);
	let mono = await shortcutCommand(preferences, 'New mono track');
	const original = await mono.getByRole('textbox').first().inputValue();
	await chooseShortcutExport(page, preferences,
		'<audacitykeyboard><command name="NewMonoTrack" key="Ctrl+Alt+Shift+F6"></audacitykeyboard>');
	await expect(preferences.getByRole('alert')).toContainText('Could not read this Audacity shortcut file.');
	await expect(preferences.getByRole('button', { name: 'Apply shortcuts', exact: true })).toHaveCount(0);
	await expect(mono.getByRole('textbox').first()).toHaveValue(original);
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await page.reload();
	editor = await waitForEditor(page);
	preferences = await openShortcutPreferences(page, editor);
	mono = await shortcutCommand(preferences, 'New mono track');
	await expect(mono.getByRole('textbox').first()).toHaveValue(original);
});

test('clearing a command and reassigning its shortcut applies the reviewed changes together', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const preferences = await openShortcutPreferences(page, editor);
	const mono = await shortcutCommand(preferences, 'New mono track');
	await expect(mono.getByRole('textbox').first()).toHaveValue('Ctrl+Shift+N');
	await chooseShortcutExport(page, preferences, `<Shortcuts>
		<SC><key>new-mono-track</key></SC>
		<SC><key>new-label-track</key><seq>Ctrl+Shift+N</seq></SC>
	</Shortcuts>`);
	const review = preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true });
	await expect(review.getByRole('status')).toHaveText('2 commands ready to import; 0 skipped.');
	await expect(review).toContainText('1 existing shortcuts will be reassigned');
	await review.getByText('Review shortcut changes', { exact: true }).click();
	await expect(review.getByRole('listitem')).toContainText([
		'New mono track: Unassigned', 'New label track: Ctrl+Shift+N',
	]);
	await expect(mono.getByRole('textbox').first()).toHaveValue('Ctrl+Shift+N');
	await review.getByRole('button', { name: 'Apply shortcuts', exact: true }).click();
	await expect(preferences.getByRole('status').filter({ hasText: 'Imported 2 commands.' })).toBeVisible();
	await expect(mono.getByRole('textbox').first()).toHaveValue('');
	const label = await shortcutCommand(preferences, 'New label track');
	await expect(label.getByRole('textbox').first()).toHaveValue('Ctrl+Shift+N');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const addLabel = editor.getByRole('button', { name: 'Add label', exact: true });
	const originalLabels = await addLabel.count();
	await editor.getByRole('group', { name: 'Playhead', exact: true }).focus();
	await page.keyboard.press('Control+Shift+N');
	await expect(addLabel).toHaveCount(originalLabels + 1);
});

// Node retains independent parser/session/store refusal matrices for these command families.
test('unsupported shortcut dialects disclose every skip and preserve selected peers, ranges and bindings', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [toneA, toneB]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	for (const [name, frame] of [['Selection start', 9600], ['Selection end', 19200]]) {
		const group = editor.getByRole('group', { name, exact: true });
		await group.locator('.timecode__format-button').click();
		await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
		await group.locator('.timecode-digit').first().click();
		await page.keyboard.type(String(frame).padStart(12, '0')); await page.keyboard.press('Enter');
		await expect(group.locator('.timecode-digit')).toHaveText([...String(frame).padStart(12, '0')]);
	}
	const playhead = editor.getByRole('group', { name: 'Playhead', exact: true });
	await playhead.locator('.timecode__format-button').click();
	await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	let preferences = await openShortcutPreferences(page, editor);
	let mix = await shortcutCommand(preferences, 'Mix & Render');
	const originalMix = await mix.getByRole('textbox').first().inputValue();
	const legacy = ['FutureAudacityCommand', 'SortByName', 'SortByTime', 'Disjoin', 'SelectAll', 'SelAllTracks', 'SelNextClip', 'SelPrevClip',
		'CursorRight', 'CursorLongJumpRight', 'SelTrackStartToCursor', 'SelCursorToTrackEnd', 'TrackClose', 'MixAndRenderToNewTrack', 'SeekRightLong', 'Play'];
	const modern = ['future-audacity-command', 'mix-and-render-to-new-track', 'track-close', 'seek-left-long'];
	const imports = [
		[legacy, `<audacitykeyboard audacityversion="3.7.7">${legacy.map(command => `<command name="${command}" key="Ctrl+Alt+Shift+F7"/>`).join('')}</audacitykeyboard>`],
		[modern, `<Shortcuts>${modern.map(command => `<SC><key>${command}</key><seq>Ctrl+Alt+Shift+F7</seq></SC>`).join('')}</Shortcuts>`],
		[['PlayLooped'], '<audacitykeyboard audacityversion="3.0.5"><command name="PlayLooped" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>'],
	];
	for (const [index, [commands, xml]] of imports.entries()) {
		await chooseShortcutExport(page, preferences, xml);
		const review = preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true });
		await expect(review.getByRole('status')).toHaveText(`0 commands ready to import; ${commands.length} skipped.`);
		await expect(review.getByRole('button', { name: 'Apply shortcuts', exact: true })).toBeDisabled();
		const skipped = review.getByText('Skipped shortcuts', { exact: true });
		if (!await skipped.locator('..').evaluate(details => details.open)) await skipped.click();
		await expect(review.getByRole('listitem')).toHaveText(commands.map(command => `${command}: Command unavailable`));
		await expect(mix.getByRole('textbox').first()).toHaveValue(originalMix);
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await playhead.focus(); await page.keyboard.press('Control+Alt+Shift+F7');
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await expect(playhead.locator('.timecode-digit')).toHaveText([...'000000009600']);
		for (const [name, frame] of [['Selection start', 9600], ['Selection end', 19200]]) {
			await expect(editor.getByRole('group', { name, exact: true }).locator('.timecode-digit')).toHaveText([...String(frame).padStart(12, '0')]);
		}
		if (index < imports.length - 1) {
			preferences = await openShortcutPreferences(page, editor);
			mix = await shortcutCommand(preferences, 'Mix & Render');
		}
	}
});

async function openShortcutPreferences(page, editor) {
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	return preferences;
}

async function shortcutCommand(preferences, label) {
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill(label);
	const command = preferences.getByRole('group', { name: label, exact: true });
	await expect(command).toBeVisible();
	return command;
}

async function chooseShortcutExport(page, preferences, xml, name = 'audacity-shortcuts.xml') {
	const importButton = preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true });
	await expect(importButton).toBeVisible();
	const choosing = page.waitForEvent('filechooser');
	await importButton.click();
	await (await choosing).setFiles({ name, mimeType: 'application/xml', buffer: Buffer.from(xml) });
	await expect(preferences.getByLabel('Audacity shortcut file', { exact: true })).toHaveCount(1);
}
