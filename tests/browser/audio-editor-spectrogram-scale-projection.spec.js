/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, chooseCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { logarithmicScaleProjectFile } from '../helpers/spectrogram-scale-fixture.ts';

test('Preferences reports every scale offered by the spectrogram ruler', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	const row = editor.locator('[data-track-row]').last();
	await expect(row).toHaveAttribute('data-display-mode', 'spectrogram');
	const openRuler = async () => {
		await row.locator('[data-track-ruler]').click({ button: 'right', position: { x: 10, y: 40 } });
		const flyout = editor.locator('.ruler-flyout');
		await expect(flyout).toBeVisible();
		return flyout;
	};
	for (const [label, value] of [['Bark', 'bark'], ['ERB', 'erb'], ['Period', 'period'], ['Linear', 'linear'], ['Logarithmic', 'log'], ['Mel', 'mel']]) {
		let flyout = await openRuler();
		await flyout.getByRole('radio', { name: label, exact: true }).click();
		await expect(flyout.getByRole('radio', { name: label, exact: true })).toBeChecked();
		await page.keyboard.press('Escape');
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Track display$/u }).click();
		const scale = preferences.getByRole('combobox', { name: 'Scale', exact: true });
		await expect(scale).toHaveValue(value);
		await expect(scale.locator('option:checked')).toHaveText(label);
		// An unrelated existing preference edit must retain the selected scale.
		await preferences.getByRole('combobox', { name: 'Window size', exact: true }).selectOption('4096');
		await expect(scale).toHaveValue(value);
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		flyout = await openRuler();
		await expect(flyout.getByRole('radio', { name: label, exact: true })).toBeChecked();
		await page.keyboard.press('Escape');
	}
});

test('Preferences reports an admitted native logarithmic alias without changing its scale', async ({ page }) => {
	const { project, clip, file } = await logarithmicScaleProjectFile();
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await waitForProjectActivation(editor);
	await editor.locator(`[data-clip-id="${clip.id}"] .clip-header`).click();
	const ruler = editor.locator('[data-track-ruler]');
	await ruler.click({ button: 'right', position: { x: 10, y: 40 } });
	await expect(editor.locator('.ruler-flyout').getByRole('radio', { name: 'Logarithmic', exact: true })).toBeChecked();
	await page.keyboard.press('Escape');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Track display$/u }).click();
	const scale = preferences.getByRole('combobox', { name: 'Scale', exact: true });
	await expect(scale).toHaveValue('log');
	await expect(scale.locator('option:checked')).toHaveText('Logarithmic');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await ruler.click({ button: 'right', position: { x: 10, y: 40 } });
	await expect(editor.locator('.ruler-flyout').getByRole('radio', { name: 'Logarithmic', exact: true })).toBeChecked();
});
