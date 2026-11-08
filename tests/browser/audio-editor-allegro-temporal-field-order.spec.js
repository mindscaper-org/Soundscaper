/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

for (const [fields, expected] of [['Q T1', '1'], ['T1 Q', '0.5']]) {
	test(`Allegro ${fields} retains its native temporal field evaluation`, async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [{ name: 'Field order.gro', mimeType: 'text/plain',
			buffer: Buffer.from(`#track 0\nT0 -tempor:60\nT1 -tempor:120\nT0\n${fields} V0 P60 L100\n`) }]);
		await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
		const note = editor.getByRole('group', { name: 'Note editor', exact: true });
		await note.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
		await expect(note.getByRole('spinbutton', { name: 'Note start (seconds)', exact: true })).toHaveValue('1');
		await expect(note.getByRole('spinbutton', { name: 'Note duration (seconds)', exact: true })).toHaveValue(expected);
	});
}
