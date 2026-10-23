/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { hasDurableMediaStorageCapability } from './helpers/durable-media-storage-capability.js';

for (const [name, invalid, errorWord] of [
	['hexadecimal color', ['LUT_3D_SIZE 2', ...Array.from({ length: 8 }, () => '0x1 0 0')], 'decimal'],
	['a late domain keyword', ['LUT_3D_SIZE 2', '0 0 0', '1 0 0', '0 1 0', '1 1 0',
		'0 0 1', '1 0 1', '0 1 1', '1 1 1', 'DOMAIN_MIN -1 -1 -1'], 'keyword'],
]) test(`the grading chooser refuses ${name} before changing the programme and accepts a decimal retry`, async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__cubeProgrammePixel = null;
		const put = CanvasRenderingContext2D.prototype.putImageData;
		CanvasRenderingContext2D.prototype.putImageData = function (...args) {
			const result = Reflect.apply(put, this, args), image = args[0];
			if (image.width >= 320 && image.height >= 180) {
				const offset = (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) * 4;
				globalThis.__cubeProgrammePixel = Array.from(image.data.slice(offset, offset + 4));
			}
			return result;
		};
	});
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	test.skip(!await page.evaluate(hasDurableMediaStorageCapability, 'indexeddb-only'), 'Native LUT storage requires durable Blob support.');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid']);
	const clip = editor.getByRole('group', { name: 'Video clip: Solid', exact: true }); await clip.press('Enter');
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
	const inspector = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	await inspector.getByRole('spinbutton', { name: 'Opacity', exact: true }).fill('0.9');
	await inspector.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(inspector.getByRole('status').last()).toHaveText('Selected visual updated.');
	await inspector.getByRole('button', { name: 'Close', exact: true }).click(); await expect(inspector).toBeHidden();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Grading & Finishing Presets']);
	const dialog = page.getByRole('dialog', { name: 'Grading & Finishing Presets', exact: true });
	const choose = async (lines) => {
		const choosing = page.waitForEvent('filechooser'); await dialog.getByRole('button', { name: 'Choose .cube LUT', exact: true }).click();
		const text = [...lines, ''].join('\n');
		await (await choosing).setFiles({ name: 'Color.cube', mimeType: 'text/plain', buffer: Buffer.from(text) });
	};
	await choose(invalid);
	await expect.poll(async () => await dialog.getByRole('status').textContent()).toMatch(new RegExp(`Presentation|${errorWord}`, 'u'));
	const observed = { document: JSON.parse(await dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true }).inputValue()),
		pixel: await page.evaluate(() => globalThis.__cubeProgrammePixel) };
	expect(observed.document.videoVisualPresentations[0].grade?.lut ?? null, JSON.stringify(observed)).toBeNull();
	await expect(dialog.getByRole('status')).toContainText(errorWord);
	await choose(['LUT_3D_SIZE 2', ...Array.from({ length: 8 }, () => '1.0 0 0')]);
	await expect(dialog.getByRole('status')).toHaveText(/^Presentation .+: [0-9a-f]{12}$/u);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await expect(dialog).toBeHidden();
	await expect.poll(() => page.evaluate(() => globalThis.__cubeProgrammePixel?.[0] ?? 0)).toBeGreaterThan(200);
});
