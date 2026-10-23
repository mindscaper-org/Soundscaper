/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, waitForEditor } from './audio-editor-test-helpers.js';

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

for (const exported of EXPORTS) {
	test(`reviews Audacity ${exported.version} shortcuts and keeps the applied bindings after reload`, async ({ page }) => {
		let editor = await bootEditor(page, '/embed/en/');
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
	});
}

test('canceling a shortcut import leaves the existing bindings unchanged', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
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
	let editor = await bootEditor(page, '/embed/en/');
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
	const editor = await bootEditor(page, '/embed/en/');
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

test('an entirely unsupported import explains its skips and cannot be applied', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const preferences = await openShortcutPreferences(page, editor);
	await chooseShortcutExport(page, preferences, `<audacitykeyboard audacityversion="3.7.7">
		<command name="FutureAudacityCommand" key="Ctrl+Alt+Shift+F7"/>
	</audacitykeyboard>`);
	const review = preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true });
	await expect(review.getByRole('status')).toHaveText('0 commands ready to import; 1 skipped.');
	await expect(review.getByRole('button', { name: 'Apply shortcuts', exact: true })).toBeDisabled();
	await review.getByText('Skipped shortcuts', { exact: true }).click();
	await expect(review.getByRole('listitem')).toHaveText('FutureAudacityCommand: Command unavailable');
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
