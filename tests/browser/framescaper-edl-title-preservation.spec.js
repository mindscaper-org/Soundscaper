/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseNestedCommandAction, commitInput, disableNativeSavePicker, downloadBytes, importFiles,
} from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { readWithReference } from '../helpers/interchange-reference.ts';

for (const length of [30]) test(`EDL retains the actual renamed project title of length ${length}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicSilentVideoFixture('Title check.webm')]);
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	const dialog = page.getByRole('dialog', { name: 'Rename project', exact: true });
	const title = `Production ${'x'.repeat(length - 11)}`;
	await commitInput(dialog.locator('[data-project-name-input] input'), title);
	await dialog.getByRole('button', { name: 'Save name', exact: true }).click();
	await expect(editor.locator('[data-project-name]')).toHaveText(title);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export edit list (EDL)']);
	const download = await downloading;
	const text = new TextDecoder().decode(await downloadBytes(download));
	await download.delete();
	expect(text.split('\n')[0]).toBe(`TITLE: ${title}`);
	expect(readWithReference(text, 'cmx_3600', { rate: 30 }, '.edl')[0]?.name).toBe(title);
});
