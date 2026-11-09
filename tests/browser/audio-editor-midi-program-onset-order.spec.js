/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';

function input(lateTick) {
	const body = [0, 192, 5, 0, 144, 60, 100, lateTick, 192, 10, 0x83, 0x60, 128, 60, 0, 0, 255, 47, 0];
	return Buffer.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, 0, 0, 0, body.length, ...body]);
}

test('FileImport refuses a same-tick program change that would acquire the preceding note', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('input[data-import-input]').setInputFiles({ name: 'Late patch.mid', mimeType: 'audio/midi', buffer: input(0) });
	await expect(page.locator('[data-editor-toast="workspace-error"]')).toContainText('MIDI program order cannot preserve a note onset assignment');
	await expect(editor).toHaveAttribute('data-clip-count', '0');
});

test('a later tempo edit refuses an export that would acquire a preceding note', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/'), bytes = input(1); bytes[12] = 18; bytes[13] = 192;
	await importFiles(editor, [{ name: 'Retained patch chronology.mid', mimeType: 'audio/midi', buffer: bytes }]);
	await chooseNestedCommandAction(page, editor, 'View', ['Workspace', 'Music']);
	await expect(editor).toHaveAttribute('data-workspace-preset', 'music');
	const tempo = editor.getByRole('spinbutton', { name: 'Project tempo (BPM)', exact: true });
	await tempo.fill('20'); await tempo.blur(); await expect(tempo).toHaveValue('20');
	const downloads = []; page.on('download', download => downloads.push(download));
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export MIDI (beta)']);
	await expect(page.locator('[data-editor-toast="workspace-error"]')).toContainText('MIDI export cannot preserve program order at a note onset');
	expect(downloads).toHaveLength(0);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});
