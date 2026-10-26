/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction, chooseNestedCommandAction, closeWorkspacePanel,
	disableNativeSavePicker, downloadBytes, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { readDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';

test('authored comment indentation and final line break survive DAWproject delivery and File Open', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]); await waitForProjectActivation(editor);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const comments = '\n  Opening: retain the breath.\n\tEnding: let it ring.\n';
	let field = editor.locator('[data-metadata-editor]').getByRole('textbox', { name: 'Comments', exact: true });
	await field.fill(comments); await field.press('Tab');
	await expect(field).toHaveValue(comments);
	await closeWorkspacePanel(editor, 'metadata');
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const bytes = await downloadBytes(await downloading);
	const archive = await readDawprojectArchive(new Blob([bytes]));
	try {
		const text = await page.evaluate(xml => new DOMParser().parseFromString(xml, 'application/xml')
			.querySelector('Comment')?.textContent, archive.metadataXml);
		expect(text).toBe(comments);
	} finally { await archive.close(); }
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Notes.dawproject', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
	await expect(editor.locator('[data-status]')).toContainText('DAWproject imported.', { timeout: 30_000 });
	await waitForProjectActivation(editor);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	field = editor.locator('[data-metadata-editor]').getByRole('textbox', { name: 'Comments', exact: true });
	await expect(field).toHaveValue(comments);
});
