/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseDropdown, collectClientErrors,
	disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes,
	registerAudioEditorHooks, waitForProjectActivation,
} from './audio-editor-test-helpers.js';

async function projectWithChapter(page, existingEditor = null) {
	const editor = existingEditor ?? await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'chapter-source.wav', frequency: 330, duration: 0.5 })]);
	await chooseCommandAction(page, editor, 'Edit', 'Add label');
	const title = editor.getByRole('textbox', { name: /^Edit labels:/ });
	await title.fill('Opening chapter');
	await title.press('Enter');
	await expect(editor.getByRole('group', { name: 'Edit labels: Opening chapter', exact: true })).toBeVisible();
	return editor;
}

test.describe('embedded audio chapters', () => {
	registerAudioEditorHooks();

	test('chapter controls retain label-free feedback and opt-in native MP3 delivery', async ({ page }) => {
		const caseTimeout = test.info().timeout;
		test.setTimeout(caseTimeout * 2 + 60_000);
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await test.step('without labels', async () => {
			await importFiles(editor, [createWavFixture({ name: 'without-labels.wav', frequency: 330, duration: 0.25 })]);
			const dialog = await openExportDialog(page, editor);
			await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'MP3');
			await expect(dialog.getByRole('checkbox', { name: 'Embed labels as chapters', exact: true })).toBeDisabled();
			await expect(dialog.getByText('Add a label to embed chapters in the exported file.', { exact: true })).toBeVisible();
			await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
			await expect(dialog).toBeHidden();
		}, { timeout: caseTimeout });
		await test.step('chapter format and output controls', async () => {
			const previousId = await editor.getAttribute('data-project-id');
			await editor.getByRole('button', { name: 'New project', exact: true }).click();
			await expect(editor).not.toHaveAttribute('data-project-id', previousId);
			await waitForProjectActivation(editor);
			await expect(editor).toHaveAttribute('data-clip-count', '0');
			await expect(editor.locator('[data-label-id]')).toHaveCount(0);
			await projectWithChapter(page, editor);
			const dialog = await openExportDialog(page, editor);
			const chapters = dialog.getByRole('checkbox', { name: 'Embed labels as chapters', exact: true });
			await expect(chapters).toHaveCount(0);
			await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'MP3');
			await expect(chapters).not.toBeChecked();
			await chapters.check();
			await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'AAC / M4A');
			await expect(chapters).toBeChecked();
			await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), 'Individual stems (split by tracks)');
			await expect(chapters).toHaveCount(0);
			await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), 'Entire project');
			await expect(chapters).toBeChecked();
			await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
			await expect(chapters).toHaveCount(0);
			await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
			await expect(dialog).toBeHidden();
		}, { timeout: caseTimeout });
		await test.step('native MP3 chapter delivery', async () => {
			const dialog = await openExportDialog(page, editor);
			await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'MP3');
			// Reset the opt-in before checking the delivery path.
			await dialog.getByRole('checkbox', { name: 'Embed labels as chapters', exact: true }).uncheck();
			await expect(dialog.getByRole('checkbox', { name: 'Embed labels as chapters', exact: true })).not.toBeChecked();
			await dialog.getByRole('checkbox', { name: 'Embed labels as chapters', exact: true }).check();
			await dialog.getByRole('button', { name: 'Export', exact: true }).click();
			const download = dialog.locator('[data-export-download]');
			await expect(download).toBeVisible({ timeout: 30_000 });
			await expect(download).toHaveAttribute('download', /\.mp3$/u);
			const bytes = Buffer.from(await readDownloadBytes(page, download));
			expect(bytes.subarray(0, 3).toString('ascii')).toBe('ID3');
			for (const text of ['CHAP', 'CTOC', 'Opening chapter']) expect(bytes.includes(Buffer.from(text))).toBe(true);
			expect(errors).toEqual([]);
		}, { timeout: 60_000 });
	});

	test('opting in downloads an M4A with label chapter metadata through native AAC', async ({ page }) => {
		test.setTimeout(60_000);
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await projectWithChapter(page);
		const supported = await page.evaluate(async () => {
			if (typeof AudioEncoder !== 'function' || typeof AudioEncoder.isConfigSupported !== 'function') return false;
			try {
				return (await AudioEncoder.isConfigSupported({
					codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 2,
					bitrate: 192_000, aac: { format: 'aac' },
				})).supported === true;
			} catch { return false; }
		});
		test.skip(!supported, 'The browser does not support the exact AAC-LC export tuple.');
		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'AAC / M4A');
		await dialog.getByRole('checkbox', { name: 'Embed labels as chapters', exact: true }).check();
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const download = dialog.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 30_000 });
		await expect(download).toHaveAttribute('download', /\.m4a$/u);
		const bytes = Buffer.from(await readDownloadBytes(page, download));
		expect(bytes.subarray(4, 8).toString('ascii')).toBe('ftyp');
		for (const text of ['chpl', 'Opening chapter']) expect(bytes.includes(Buffer.from(text))).toBe(true);
		expect(errors).toEqual([]);
	});
});
