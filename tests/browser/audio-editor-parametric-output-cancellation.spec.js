/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker, importFiles, openParametricEqSelectionEffect } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('Escape cancels a held Parametric output drag through the delivered audio', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Output cancellation.wav', frequency: 500,
		duration: 1, channelCount: 1, channelAmplitudes: [0.15] })]);
	const dry = peak(await exportSamples(page, editor));
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const dialog = await openParametricEqSelectionEffect(page, editor);
	const range = dialog.locator('.audio-editor-parametric-eq__output input[type="range"]');
	await range.scrollIntoViewIfNeeded();
	const box = await range.boundingBox(); expect(box).not.toBeNull();
	const at = gain => ({ x: box.x + (gain + 24) / 48 * box.width, y: box.y + box.height / 2 });
	await page.mouse.move(at(0).x, at(0).y);
	await page.mouse.down();
	await page.mouse.move(at(6).x, at(6).y, { steps: 4 });
	await page.mouse.up();
	expect(Number(await range.inputValue())).toBeGreaterThan(5);
	await dialog.locator('.audio-editor-parametric-eq__toolbar').getByRole('button', { name: 'Reset', exact: true }).click();
	await expect(range).toHaveValue('0');
	await page.mouse.move(at(0).x, at(0).y);
	await page.mouse.down();
	await page.mouse.move(at(6).x, at(6).y, { steps: 4 });
	expect(Number(await range.inputValue())).toBeGreaterThan(5);
	await page.keyboard.press('Escape');
	await expect(dialog).toBeVisible();
	await expect(range).toHaveValue('0');
	await expect(range).toBeFocused();
	await page.mouse.move(at(12).x, at(12).y, { steps: 4 });
	await page.mouse.up();
	await expect(range).toHaveValue('0');
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(dialog).toBeHidden();
	expect(peak(await exportSamples(page, editor))).toBeCloseTo(dry, 3);
});

function peak(samples) { return samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0); }

test('a held Parametric output arrow key cannot repeat after Escape cancels it', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Keyboard cancellation.wav', duration: 1 })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const dialog = await openParametricEqSelectionEffect(page, editor);
	const range = dialog.locator('.audio-editor-parametric-eq__output input[type="range"]');
	await range.focus();
	await page.keyboard.down('ArrowRight');
	await expect(range).toHaveValue('0.1');
	await page.keyboard.press('Escape');
	await expect(dialog).toBeVisible();
	await expect(range).toHaveValue('0');
	await page.keyboard.down('ArrowRight');
	await expect(range).toHaveValue('0');
	await page.keyboard.up('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await expect(range).toHaveValue('0.1');
});
