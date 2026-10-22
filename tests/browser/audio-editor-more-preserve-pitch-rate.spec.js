/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';

test.use({ browserCoverage: false });

test('Preserve pitch reconciles a previously chosen unsupported speed and starts playback', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'speed bounds.wav', duration: 8 })]);
	await editor.getByRole('button', { name: 'Play options', exact: true }).click();
	const preserve = editor.getByRole('menuitem', { name: 'Preserve pitch', exact: true });
	if (await preserve.getAttribute('aria-checked') === 'true') await preserve.click();
	const speed = editor.getByRole('slider', { name: 'Playback speed', exact: true });
	await speed.fill('3');
	await preserve.click();
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'Play at speed', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause play at speed', exact: true })).toBeVisible();
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await editor.getByRole('button', { name: 'Play options', exact: true }).click();
	await expect(speed).toHaveValue('2');
	await expect(speed).toHaveAttribute('min', '0.5');
	await expect(speed).toHaveAttribute('max', '2');
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'Customize toolbar', exact: true }).click();
	await page.getByRole('dialog', { name: 'Customize toolbar', exact: true }).getByRole('checkbox', { name: 'Play at speed', exact: true }).click();
	await page.keyboard.press('Escape');
	const readout = editor.locator('[data-varispeed-display]');
	await expect(readout).toHaveAttribute('aria-valuemin', '50');
	await expect(readout).toHaveAttribute('aria-valuemax', '200');
	await readout.press('ArrowUp');
	await expect(readout).toHaveText('200%');
});
