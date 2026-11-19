/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

// The full key/duration matrix crosses controller, synthesis and archive boundaries in Node.
for (const fields of ['K64 Q']) test(`Allegro ${fields} retains its native implied note pitch`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'Key duration.gro', mimeType: 'text/plain',
		buffer: Buffer.from(`#track 0\nT0 -tempor:120\nT0 V0 ${fields} L100\n`) }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const note = editor.getByRole('group', { name: 'Note editor', exact: true });
	await note.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
	await expect(note.getByRole('spinbutton', { name: 'Pitch (MIDI number)', exact: true })).toHaveValue('64');
});
