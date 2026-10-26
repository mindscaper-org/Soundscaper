/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, readFile } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseFileAction, chooseNestedCommandAction,
	disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';

test('Podcast JSON delivery retains distinct imported sample-precision chapter boundaries', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles({ name: 'Precision.txt', mimeType: 'text/plain',
		buffer: Buffer.from('0.5\t0.5\tFirst boundary\n0.5000208333333333\t0.5000208333333333\tNext sample\n') });
	await expect(editor.locator('[data-status]')).toHaveText('Imported 2 label(s).');
	await waitForProjectActivation(editor);
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export labels']);
	const dialog = page.getByRole('dialog', { name: 'Export labels', exact: true });
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Format', exact: true }), 'As Podcast 2.0 chapters (JSON)');
	const downloading = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export labels', exact: true }).click();
	const download = await downloading; expect(download.suggestedFilename()).toMatch(/\.json$/u);
	const document = JSON.parse(await readFile(await download.path(), 'utf8'));
	expect(document.chapters.map(chapter => Math.round(chapter.startTime * 48_000))).toEqual([24_000, 24_001]);
	expect(document.chapters.map(chapter => chapter.title)).toEqual(['First boundary', 'Next sample']);
	await expect(dialog).toBeHidden();
});
