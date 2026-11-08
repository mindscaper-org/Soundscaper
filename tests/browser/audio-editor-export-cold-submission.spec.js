/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';

test('cold Export locks the submitted settings while Cancel admits a replacement delivery', async ({ page }) => {
	let entered = false, release;
	const held = new Promise(resolve => { release = resolve; });
	await page.route(/\/export-service-[^/]+\.js$/u, async route => {
		const response = await route.fetch();
		entered = true;
		await held;
		await route.fulfill({ response });
	});
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Delivery.wav', duration: .1 })]);
	try {
		let dialog = await openExportDialog(page, editor);
		const rate = () => dialog.locator('[data-export-field="sampleRate"] input');
		await expect(rate()).toHaveValue('48000');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		await expect.poll(() => entered).toBe(true);
		await expect(rate()).toBeDisabled();
		await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeDisabled();
		await expect(dialog.locator('[data-export-field="format"]').getByRole('button')).toBeDisabled();
		await expect(dialog.getByRole('button', { name: 'Metadata', exact: true })).toBeDisabled();
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(dialog).toBeHidden();
		dialog = await openExportDialog(page, editor);
		await expect(rate()).toBeEnabled();
		await rate().fill('24000');
		await rate().press('Tab');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		await expect(rate()).toBeDisabled();
		release();
		const link = dialog.locator('[data-export-download]');
		await expect(link).toHaveAttribute('href', /^blob:/u);
		const delivered = await inspectWavBlobPcm(new Blob([await readDownloadBytes(page, link)]));
		expect(delivered).toMatchObject({ sampleRate: 24000, frameCount: 2400, channelCount: 2 });
		await expect(rate()).toBeEnabled();
		await rate().fill('48000');
		await rate().press('Tab');
		const previous = await link.getAttribute('href');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		await expect(link).not.toHaveAttribute('href', previous);
		const warm = await inspectWavBlobPcm(new Blob([await readDownloadBytes(page, link)]));
		expect(warm).toMatchObject({ sampleRate: 48000, frameCount: 4800, channelCount: 2 });
	} finally { release(); }
});
