/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('a clip Auto Duck can select another track without offering its own input as a detector', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tracks', 'Remove tracks');
	await importFiles(editor, [toneA, toneB]);
	const panel = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	await panel.getByText('Effects', { exact: true }).click();
	await addRackEffect(page, panel, 'track', 'Auto Duck');
	const dialog = page.getByRole('dialog', { name: 'Auto Duck', exact: true });
	const control = dialog.getByRole('group', { name: 'Control track', exact: true });
	await expect(control).toContainText('browser-tone-b');
	await control.getByRole('button', { exact: false }).click();
	const options = page.getByRole('listbox');
	await expect(options.getByRole('option', { name: 'browser-tone-b', exact: true })).toBeVisible();
	await expect(options.getByRole('option', { name: 'browser-tone-a', exact: true })).toHaveCount(0);
});
