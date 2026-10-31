/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('Escape cancels adjustment of an existing spectral band', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clip.locator('.clip-header').click();
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Select', ['Spectral', 'Spectral brush']);
	const brush = editor.getByRole('button', { name: 'Spectral brush', exact: true });
	const box = await brush.boundingBox();
	expect(box).not.toBeNull();
	// Keep the initial band's time range inside the actual audio clip.
	const clipBox = await clip.boundingBox();
	expect(clipBox).not.toBeNull();
	const start = { x: clipBox.x + clipBox.width / 2, y: box.y + box.height / 3 };
	await expect(brush).toBeEnabled();
	await brush.hover({ position: { x: start.x - box.x, y: start.y - box.y } });
	expect(await brush.evaluate((element, point) => (
		element.ownerDocument.elementFromPoint(point.x, point.y) === element
	), start)).toBe(true);
	await page.mouse.down();
	const draft = brush.locator('.audio-editor-spectral-brush__preview');
	await expect(draft).toBeVisible();
	await page.mouse.move(clipBox.x + clipBox.width * 3 / 4, start.y + 30);
	await expect(draft).toBeVisible();
	await page.mouse.up();
	const maximum = editor.getByRole('slider', { name: 'Spectral selection maximum-frequency handle', exact: true });
	await expect(maximum).toBeVisible();
	const original = await maximum.getAttribute('aria-valuenow');
	await maximum.focus();
	const handle = await maximum.boundingBox();
	expect(handle).not.toBeNull();
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 20, { steps: 4 });
	await expect(maximum).not.toHaveAttribute('aria-valuenow', original);
	await page.keyboard.press('Escape');
	await expect(maximum).toHaveAttribute('aria-valuenow', original);
	await page.mouse.up();
	await expect(maximum).toHaveAttribute('aria-valuenow', original);
});
