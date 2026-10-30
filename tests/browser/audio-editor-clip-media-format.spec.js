/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, collectClientErrors, importFiles, openClipProperties, waitForEditor } from './audio-editor-test-helpers.js';

test.use({ viewport: { width: 1440, height: 1000 } });

test('Format resamples at the chosen precision and reinterprets the rate with undo and persistence', async ({ page }) => {
	const errors = collectClientErrors(page);
	const recording = createWavFixture({ name: 'format-16000.wav', sampleRate: 16000, frequency: 440, duration: 1, channelCount: 1 });
	let editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [recording]);
	let panel = await openClipProperties(page, editor, clipByName(editor, recording.name), { additional: false });
	const rate = () => panel.getByRole('spinbutton', { name: 'Sample rate (Hz)', exact: true });
	const depth = () => panel.getByRole('combobox', { name: 'Bit depth', exact: true });
	const length = () => panel.getByRole('textbox', { name: 'Length', exact: true });
	await expect(rate()).toHaveValue('16000');
	await expect(length()).toHaveValue('1');
	await rate().fill('32000');
	await depth().selectOption('int24');
	await expect(length()).toHaveValue('1');
	await panel.getByRole('button', { name: 'Resample', exact: true }).click();
	await expect(panel.getByRole('button', { name: 'Resample', exact: true })).toBeDisabled();
	await expect(panel.locator('[data-group="format"]')).toHaveAttribute('data-clip-source-sample-rate', '32000');
	await expect(rate()).toHaveValue('32000');
	await expect(depth()).toHaveValue('int24');
	await expect(length()).toHaveValue('1');
	await rate().fill('16000');
	await panel.getByRole('button', { name: 'Reinterpret', exact: true }).click();
	await expect(length()).toHaveValue('2');
	await expect(rate()).toHaveValue('16000');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(length()).toHaveValue('1');
	await expect(rate()).toHaveValue('32000');
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(length()).toHaveValue('2');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload();
	editor = await waitForEditor(page);
	panel = await openClipProperties(page, editor,
		editor.getByRole('group', { name: /^format-16000\.wav.* clip(?:,|$)/u }), { additional: false });
	await expect(rate()).toHaveValue('16000');
	await expect(depth()).toHaveValue('int24');
	await expect(length()).toHaveValue('2');
	expect(errors).toEqual([]);
});

test('Clip properties presents the media controls beside the fields they affect', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'media-controls.wav', frequency: 330, duration: 1 });
	await importFiles(editor, [recording]);
	const panel = await openClipProperties(page, editor, clipByName(editor, recording.name), { additional: false });
	const pitchUnits = panel.getByRole('button', { name: /^Pitch unit:/u });
	await expect(pitchUnits.locator('[data-glyph="Tuning fork"]')).toBeVisible();
	await pitchUnits.click();
	await expect(pitchUnits).toHaveText('%');
	await expect(panel.getByRole('textbox', { name: /^Pitch \(percent/u })).toHaveValue('0');
	await expect(panel.getByRole('checkbox', { name: 'Optimize for voice', exact: true })).toBeVisible();
	await panel.getByRole('checkbox', { name: 'Optimize for voice', exact: true }).check();
	const reverse = panel.getByRole('switch', { name: 'Reverse', exact: true });
	const invert = panel.getByRole('switch', { name: 'Invert', exact: true });
	await expect(reverse).toHaveAttribute('aria-checked', 'false');
	await invert.click();
	await expect(invert).toHaveAttribute('aria-checked', 'true');
	await expect(panel.getByRole('switch', { name: 'Stretch with project tempo changes', exact: true })).toBeVisible();
	await expect(panel.getByRole('button', { name: 'Reset', exact: true })).toBeEnabled();
	await expect(panel.getByRole('button', { name: 'Render', exact: true })).toBeDisabled();
	for (const target of ['−1 dBFS', '−14 LUFS']) await expect(panel.getByRole('button', { name: target, exact: true })).toBeVisible();
	await panel.getByRole('button', { name: 'Media settings', exact: true }).click();
	const menu = page.getByRole('menu', { name: 'Media settings', exact: true });
	for (const label of ['Timecode fields', 'Pitch unit', 'Fade in shape', 'Fade out shape']) {
		await expect(menu.getByRole('menuitem', { name: label, exact: true })).toHaveCount(0);
		await expect(menu.getByRole('menuitemcheckbox', { name: label, exact: true })).toHaveCount(0);
	}
	await menu.press('Escape');
	expect(errors).toEqual([]);
});
