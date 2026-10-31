/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, disableNativeSavePicker, importFiles, openExportDialog,
	readDownloadBytes, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';

registerAudioEditorHooks();

test('an imported automatic video preset permits a different explicit delivery size', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const webgl2Available = await page.evaluate(() => {
		const context = document.createElement('canvas').getContext('webgl2');
		if (!context) return false;
		context.getExtension('WEBGL_lose_context')?.loseContext();
		return true;
	});
	test.skip(!webgl2Available, 'The delivery-size export requires WebGL2; this browser host disables its creation.');
	await importFiles(editor, [createDeterministicSilentVideoFixture('Preset source.webm')]);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'MP4 video');
	const chooserPromise = page.waitForEvent('filechooser');
	await dialog.getByRole('button', { name: 'More options', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Import preset', exact: true }).click();
	await (await chooserPromise).setFiles({ name: 'Automatic.json', mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, presets: [{ schemaVersion: 1, id: 'automatic',
			label: 'Small automatic', kind: 'video', format: 'mp4', settings: {
				maximumWidth: 64, maximumHeight: 36, maximumFrameRate: { num: 10, den: 1 },
			} }] })),
	});
	await dialog.getByRole('button', { name: 'Preset', exact: true }).click();
	await page.getByRole('option', { name: 'Small automatic (custom)', exact: true }).click();
	const size = dialog.locator('[data-export-field="canvasSize"] input');
	await size.nth(0).fill('128');
	await size.nth(1).fill('72');
	await expect(size.nth(0)).toHaveValue('128');
	await expect(size.nth(1)).toHaveValue('72');
	const webGl2Available = await page.evaluate(hasWebGl2Capability);
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	const error = page.locator('[data-editor-toast="workspace-error"], [data-editor-toast="workspace-status-error"]');
	await expect(link.filter({ visible: true }).or(error)).toBeVisible({ timeout: 60_000 });
	if (!webGl2Available) {
		await expect(error).toBeVisible();
		await expect(error).toContainText('WebGL2 is unavailable.');
		await expect(link).toBeHidden();
		return;
	}
	await expect(link).toBeVisible();
	const bytes = await readDownloadBytes(page, link);
	const dimensions = await page.evaluate(async data => {
		const url = URL.createObjectURL(new Blob([Uint8Array.from(data)], { type: 'video/mp4' }));
		const video = document.createElement('video');
		try {
			await new Promise((resolve, reject) => {
				video.onloadedmetadata = resolve;
				video.onerror = () => reject(new Error('The output is not playable.'));
				video.src = url;
			});
			return [video.videoWidth, video.videoHeight];
		} finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
	}, Array.from(bytes));
	expect(dimensions).toEqual([128, 72]);
});
