/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';
import { hasDurableMediaStorageCapability } from './helpers/durable-media-storage-capability.js';

for (const [name, invalid, errorWord] of [
	['hexadecimal color', ['LUT_3D_SIZE 2', ...Array.from({ length: 8 }, () => '0x1 0 0')], 'decimal'],
	['a late domain keyword', ['LUT_3D_SIZE 2', '0 0 0', '1 0 0', '0 1 0', '1 1 0',
		'0 0 1', '1 0 1', '0 1 1', '1 1 1', 'DOMAIN_MIN -1 -1 -1'], 'keyword'],
]) test(`the grading chooser refuses ${name} before changing the programme and accepts a decimal retry`, async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const exactPreview = await page.evaluate(hasWebGl2Capability);
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
	const preview = editor.locator('[data-video-preview]');
	if (exactPreview) await expect(preview).toHaveAttribute('data-video-preview-renderer', 'ready');
	await choose(invalid);
	await expect.poll(async () => await dialog.getByRole('status').textContent()).toMatch(new RegExp(`Presentation|${errorWord}`, 'u'));
	const observed = { document: JSON.parse(await dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true }).inputValue()) };
	expect(observed.document.videoVisualPresentations[0].grade?.lut ?? null, JSON.stringify(observed)).toBeNull();
	await expect(dialog.getByRole('status')).toContainText(errorWord);
	await choose(['LUT_3D_SIZE 2', ...Array.from({ length: 8 }, () => '1.0 0 0')]);
	await expect(dialog.getByRole('status')).toHaveText(/^Presentation .+: [0-9a-f]{12}$/u);
	const accepted = JSON.parse(await dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true }).inputValue());
	expect(accepted.videoVisualPresentations[0].grade.lut).toMatchObject({ size: 2, sha256: expect.stringMatching(/^[0-9a-f]{64}$/u) });
	await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await expect(dialog).toBeHidden();
	await expect(preview).toHaveAttribute('data-video-preview-visual-error', '');
	if (exactPreview) {
		await expect(preview).toHaveAttribute('data-video-preview-renderer', 'ready');
		await expect.poll(async () => (await screenshotCenterPixel(preview.locator('[data-video-preview-canvas]')))[0]).toBeGreaterThan(200);
	} else {
		test.info().annotations.push({ type: 'preview-capability', description: 'Native WebGL2 is unavailable; LUT admission and the canonical document remain checked while the preview uses its declared fallback.' });
		await expect(preview).toHaveAttribute('data-video-preview-renderer', 'fallback');
		await expect(preview).toHaveAttribute('data-video-preview-visual-pending', 'false');
	}
});

async function screenshotCenterPixel(canvas) {
	const png = (await canvas.screenshot()).toString('base64');
	return canvas.evaluate(async (_element, encoded) => {
		const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
		const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
		try {
			const sample = document.createElement('canvas'); sample.width = sample.height = 1;
			const context = sample.getContext('2d');
			context.drawImage(bitmap, Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1, 0, 0, 1, 1);
			return Array.from(context.getImageData(0, 0, 1, 1).data);
		} finally { bitmap.close(); }
	}, png);
}
