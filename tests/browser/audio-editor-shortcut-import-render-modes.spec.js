/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

// Node retains both dialects' parser, session and durable binding matrix.
test('shortcut import reviews both new-track render dialects without replacing the mix binding', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('Mix & Render');
	const mix = preferences.getByRole('group', { name: 'Mix & Render', exact: true });
	const before = await mix.getByRole('textbox').first().inputValue();
	for (const [command, xml] of [
		['MixAndRenderToNewTrack', '<audacitykeyboard audacityversion="3.7.7"><command name="MixAndRenderToNewTrack" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>'],
		['mix-and-render-to-new-track', '<Shortcuts><SC><key>mix-and-render-to-new-track</key><seq>Ctrl+Alt+Shift+F7</seq></SC></Shortcuts>'],
	]) {
		const choosing = page.waitForEvent('filechooser');
		await preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true }).click();
		await (await choosing).setFiles({ name: 'audacity.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
		await expect(preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true })).toBeEnabled({ timeout: 15_000 });
		const review = preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true });
		await expect(review.getByRole('status')).toHaveText('0 commands ready to import; 1 skipped.');
		await expect(review.getByRole('button', { name: 'Apply shortcuts', exact: true })).toBeDisabled();
		const skipped = review.getByText('Skipped shortcuts', { exact: true });
		if (!await skipped.locator('..').evaluate(details => details.open)) await skipped.click();
		await expect(review.getByRole('listitem')).toHaveText(`${command}: Command unavailable`);
		await expect(mix.getByRole('textbox').first()).toHaveValue(before);
	}
});
