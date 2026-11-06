/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openSourceMonitor } from './audio-editor-test-helpers.js';

for (const key of ['ContextMenu', 'Shift+F10']) test(`Source waveform ${key} exposes its existing marker action at the source playhead`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const file = createWavFixture({ name: 'Source keyboard.wav', frequency: 440, duration: 2, channelCount: 1 });
	await importFiles(editor, [file]);
	const panel = await openSourceMonitor(page, editor, clipByName(editor, file.name));
	const wave = panel.getByRole('region', { name: 'Source waveform', exact: true });
	const vertical = panel.getByRole('region', { name: 'Source vertical ruler', exact: true });
	await vertical.focus(); await vertical.press('Shift+F10');
	await expect(page.getByRole('menuitem', { name: 'Zoom in', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	const bounds = await wave.boundingBox(); expect(bounds).not.toBeNull();
	await wave.click({ button: 'right', position: { x: bounds.width / 2, y: bounds.height / 2 } });
	const add = page.getByRole('menuitem', { name: 'Add stretch marker', exact: true });
	await expect(add).toBeEnabled(); await add.click();
	const marker = panel.getByRole('button', { name: 'Stretch marker 1', exact: true });
	await expect(marker).toBeVisible(); await marker.focus(); await marker.press('Delete'); await expect(marker).toHaveCount(0);
	const ruler = panel.getByRole('slider', { name: 'Source timeline', exact: true });
	await ruler.focus(); await ruler.press('Home');
	for (let i = 0; i < 5; i++) await ruler.press('ArrowRight');
	await expect(ruler).toHaveAttribute('aria-valuenow', '0.5');
	await wave.focus(); await expect(wave).toBeFocused(); await wave.press(key);
	await expect(add).toBeVisible(); await expect(add).toBeEnabled(); await expect(add).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(marker).toBeVisible(); await expect(marker).toHaveAttribute('data-source-sample', '24000');
});
