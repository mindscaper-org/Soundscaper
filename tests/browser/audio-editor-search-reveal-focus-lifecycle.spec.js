/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, fileDataTransfer, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('revealing an audio clip through Search does not steal focus from later keyboard volume edits', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const clip = clipByName(editor, monoTone.name);
	await page.keyboard.press('Control+k');
	const search = editor.getByRole('combobox', { name: 'Search commands and media', exact: true });
	await expect(search).toBeFocused();
	await search.fill(monoTone.name);
	const result = editor.getByRole('group', { name: 'Timeline clips', exact: true })
		.getByRole('option').filter({ hasText: monoTone.name });
	await expect(result).toHaveCount(1);
	await result.click();
	await expect(clip).toBeFocused();
	await editor.getByRole('button', { name: 'Fit project', exact: true }).click();
	const row = editor.locator('[data-track-row]').filter({ has: clipByName(page, monoTone.name) });
	await expect(row).toHaveCount(1);
	await chooseTrackMenuAction(page, editor, row, 'Add automation');
	const volume = row.getByRole('slider', { name: 'Volume', exact: true });
	const bounds = await volume.boundingBox();
	expect(bounds).not.toBeNull();
	const minimum = Number(await volume.getAttribute('min') ?? 0);
	const maximum = Number(await volume.getAttribute('max') ?? 100);
	const fraction = (Number(await volume.inputValue()) - minimum) / (maximum - minimum);
	await volume.click({ position: { x: 7 + (bounds.width - 14) * fraction, y: bounds.height / 2 } });
	await expect(volume).toBeFocused();
	const initial = Number(await volume.inputValue());
	for (const decrement of [1, 2]) {
		await page.keyboard.press('ArrowDown');
		await expect(volume).toHaveValue(String(initial - decrement));
		await expect(editor.getByText('All changes saved locally', { exact: true })).toBeVisible();
		await expect(volume).toBeFocused();
	}
});

test('a pending Project Bin search reveal cannot take focus in a duplicate project tab', async ({ page }) => {
	await page.addInitScript(() => {
		const requestFrame = globalThis.requestAnimationFrame.bind(globalThis);
		globalThis.requestAnimationFrame = callback => {
			if (globalThis.holdBinSearchReveal && String(callback).includes('[data-project-bin-item]')) {
				globalThis.resumeBinSearchReveal = () => requestFrame(callback);
				return -1000;
			}
			return requestFrame(callback);
		};
	});
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: true });
	const bin = editor.locator('[data-project-bin-drop-target]');
	const transfer = await fileDataTransfer(page, [monoTone]);
	await bin.dispatchEvent('drop', { dataTransfer: transfer });
	await transfer.dispose();
	const card = editor.locator('[data-project-bin-item]');
	await expect(card).toHaveCount(1);
	const originalItemId = await card.first().getAttribute('data-project-bin-item');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Duplicate project']);
	const copy = editor.getByRole('tab', { name: 'Untitled project copy', exact: true });
	await expect(copy).toHaveAttribute('aria-selected', 'true');
	await waitForProjectActivation(editor);
	await expect(card.first()).toHaveAttribute('data-project-bin-item', originalItemId);
	await editor.getByRole('tab', { name: 'Untitled project', exact: true }).click();
	await waitForProjectActivation(editor);
	await page.evaluate(() => { globalThis.holdBinSearchReveal = true; });
	await page.keyboard.press('Control+k');
	const search = editor.getByRole('combobox', { name: 'Search commands and media', exact: true });
	await search.fill(monoTone.name.replace(/\.wav$/u, ''));
	const result = editor.getByRole('option').filter({ hasText: monoTone.name.replace(/\.wav$/u, '') });
	await expect(result).toHaveCount(1);
	await result.click();
	await expect.poll(() => page.evaluate(() => typeof globalThis.resumeBinSearchReveal)).toBe('function');
	await copy.click();
	await waitForProjectActivation(editor);
	await expect(copy).toBeFocused();
	await page.evaluate(async () => {
		globalThis.holdBinSearchReveal = false;
		globalThis.resumeBinSearchReveal();
		await new Promise(resolve => { requestAnimationFrame(() => { requestAnimationFrame(resolve); }); });
	});
	await expect(copy).toBeFocused();
});
