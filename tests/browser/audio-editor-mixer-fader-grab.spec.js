/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('mixer handle grabs retain their position while exposed-track clicks remain absolute', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const fader = editor.locator('.kw-audio-editor__mixer-channel--track').last().getByRole('slider', { name: /volume$/u });
	const handle = fader.locator('.mixer-fader__handle');
	await expect(fader).toHaveAttribute('aria-valuenow', '0');
	let bounds = await handle.boundingBox();
	expect(bounds).not.toBeNull();
	await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
	await expect(fader).toHaveAttribute('aria-valuenow', '0');
	for (const inset of [3, bounds.height - 3]) {
		bounds = await handle.boundingBox();
		await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + inset);
		await page.mouse.down();
		try { await expect(fader).toHaveAttribute('aria-valuenow', '0'); }
		finally { await page.mouse.up(); }
		await expect(fader).toHaveAttribute('aria-valuenow', '0');
	}
	bounds = await handle.boundingBox();
	const x = bounds.x + bounds.width / 2; const y = bounds.y + 3;
	await page.mouse.move(x, y); await page.mouse.down();
	await page.mouse.move(x, y - 8, { steps: 4 }); await page.mouse.up();
	await expect.poll(async () => Math.abs((await handle.boundingBox()).y - bounds.y + 8)).toBeLessThan(1);
	await expect.poll(async () => Number(await fader.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(fader).toHaveAttribute('aria-valuenow', '0');
	await fader.focus(); await fader.press('End');
	await expect(fader).toHaveAttribute('aria-valuenow', '12');
	const endpoint = await handle.boundingBox();
	await page.mouse.move(endpoint.x + endpoint.width / 2, endpoint.y + 3);
	await page.mouse.down();
	try {
		await expect(fader).toHaveAttribute('aria-valuenow', '12');
		await page.mouse.move(endpoint.x + endpoint.width / 2, endpoint.y + 11, { steps: 4 });
	} finally { await page.mouse.up(); }
	await expect.poll(async () => Number(await fader.getAttribute('aria-valuenow'))).toBeLessThan(12);
	const track = await fader.locator('.mixer-fader__track').boundingBox();
	expect(track).not.toBeNull();
	await page.mouse.click(track.x + track.width / 2, track.y + track.height * .7);
	await expect.poll(async () => Number(await fader.getAttribute('aria-valuenow'))).toBeCloseTo(-38.4, 1);
});
