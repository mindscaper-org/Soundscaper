/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

const note = 'T1 V0 P60 U0.5 L100\n';
const anchor = 'T2 -beatr:4\n';

for (const clock of [anchor, 'T0 -tempor:120\n']) test(`a later Allegro ${clock.trim()} refuses prior-note retiming before import, then accepts conductor-first timing`, async ({ page }) => {
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

test('a beat-authored Allegro note retains its native identity through a later anchor', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'Beat Piano.gro', mimeType: 'text/plain', buffer: Buffer.from('#track 0 Piano\nTQ1 V0 P60 Q L100\n' + anchor) }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const group = editor.getByRole('group', { name: 'Note editor', exact: true });
	await group.getByRole('combobox', { name: 'Selected note', exact: true }).selectOption({ index: 1 });
	await expect(group.getByRole('spinbutton', { name: 'Note start (seconds)', exact: true })).toHaveValue('0.5');
	await expect(group.getByRole('spinbutton', { name: 'Note duration (seconds)', exact: true })).toHaveValue('0.5');
});
