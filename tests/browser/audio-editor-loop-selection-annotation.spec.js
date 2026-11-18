/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('creating a loop that selects audio releases the previous annotation selection', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Window', 'Markers');
	const panel = editor.getByRole('region', { name: 'Markers and named regions', exact: true });
	await panel.getByRole('button', { name: 'Add region from selection', exact: true }).click();
	await chooseCommandAction(page, editor, 'View', 'Markers');
	const region = editor.getByRole('listbox', { name: 'Markers and named regions', exact: true }).getByRole('option');
	await region.click();
	await expect(region).toHaveAttribute('aria-selected', 'true');
	await chooseNestedCommandAction(page, editor, 'Select', ['Loop region', 'Creating a loop also selects audio']);
	await chooseNestedCommandAction(page, editor, 'Select', ['Loop region', 'Set loop to selection']);
	await expect(region).toHaveAttribute('aria-selected', 'false');
	await expect(editor.getByRole('group', { name: 'Selection end', exact: true }).locator('.timecode__display')).toHaveText('00h00m00.800s');
});
