/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';

test('Escape cancels a native track volume gesture until its held pointer is released', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const volume = editor.getByRole('slider', { name: 'Volume', exact: true }).first();
	const initial = await volume.inputValue();
	const box = await volume.boundingBox();
	expect(box).toBeTruthy();
	const x = box.x + 8 + (box.width - 16) * Number(initial) / 100;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * .4, y, { steps: 4 });
	await expect(volume).not.toHaveValue(initial);
	await page.keyboard.press('Escape');
	await expect(volume).toHaveValue(initial);
	await page.mouse.move(box.x + box.width * .9, y, { steps: 4 });
	await page.mouse.up();
	await expect(volume).toHaveValue(initial);
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * .6, y, { steps: 4 });
	await page.mouse.up();
	await expect(volume).not.toHaveValue(initial);
});
