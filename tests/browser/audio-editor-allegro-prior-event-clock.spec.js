/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

const note = 'T1 V0 P60 U0.5 L100\n';
const anchor = 'T2 -beatr:4\n';

// Node retains both clock refusals and beat-authored note coordinates.
for (const clock of [anchor]) test(`a later Allegro ${clock.trim()} refuses prior-note retiming before import, then accepts conductor-first timing`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('input[data-import-input]').setInputFiles({ name: 'Retimed Piano.gro', mimeType: 'text/plain', buffer: Buffer.from('#track 0 Piano\n' + note + clock) });
	await expect(page.locator('[data-editor-toast="workspace-error"]')).toContainText(/earlier events require clock retiming/iu);
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	await importFiles(editor, [{ name: 'Anchored Piano.gro', mimeType: 'text/plain', buffer: Buffer.from('#track 0 Piano\n' + clock + note) }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const group = editor.getByRole('group', { name: 'Note editor', exact: true });
	await group.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
	await expect(group.getByRole('spinbutton', { name: 'Note start (seconds)', exact: true })).toHaveValue('1');
	await expect(group.getByRole('spinbutton', { name: 'Note duration (seconds)', exact: true })).toHaveValue('0.5');
});
