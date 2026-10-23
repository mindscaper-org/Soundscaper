/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseFileAction, chooseNestedCommandAction, disableNativeSavePicker, openExportDialog, readDownloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

for (const title of ['東京の街', '音楽の映像', '映'.repeat(96)]) test(`video delivery retains the opened programme name ${title}`, async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const file = createDeterministicSilentVideoFixture(`${title.length > 20 ? 'Camera' : title}.webm`);
	const sourceMetadata = await videoMetadata(page, file.buffer);
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles(file);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await waitForProjectActivation(editor);
	if (title.length > 20) {
		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
		const rename = page.getByRole('dialog', { name: 'Rename project', exact: true });
		await rename.getByRole('textbox', { name: 'Project name', exact: true }).fill(title);
		await rename.getByRole('button', { name: 'Save name', exact: true }).click();
	}
	await expect(editor.locator('[data-project-name]')).toHaveText(title);
	const dialog = await openExportDialog(page, editor, { label: 'Export video' });
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WebM video');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 60_000 });
	const bytes = await readDownloadBytes(page, link);
	expect(bytes.byteLength).toBeGreaterThan(100);
	expect([...bytes.slice(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
	await expect(link).toHaveAttribute('download', `${title.slice(0, 83)}.webm`);
	const metadata = await videoMetadata(page, bytes);
	expect(metadata.width).toBe(sourceMetadata.width); expect(metadata.height).toBe(sourceMetadata.height);
	expect(metadata.duration).toBeGreaterThanOrEqual(sourceMetadata.duration - .01);
	expect(metadata.duration).toBeLessThan(sourceMetadata.duration + .1);
});

async function videoMetadata(page, bytes) {
	return await page.evaluate(async data => {
		const url = URL.createObjectURL(new Blob([Uint8Array.from(data)], { type: 'video/webm' }));
		const video = document.createElement('video');
		try {
			await new Promise((resolve, reject) => {
				video.onloadeddata = resolve; video.onerror = () => reject(new Error('The delivered WebM cannot be decoded.')); video.src = url;
			});
			return { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
		} finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
	}, [...bytes]);
}
