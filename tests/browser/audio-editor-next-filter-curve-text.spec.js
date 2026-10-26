/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, commitInput, importFiles } from './audio-editor-test-helpers.js';

test('an unfinished EQ gain is refused instead of flattening its authored point', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['EQ and filters', 'Filter Curve EQ']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await dialog.getByText('Curve points (Hz:dB)', { exact: true }).first().click();
	const input = dialog.getByRole('textbox', { name: 'Curve points (Hz:dB)', exact: true });
	await commitInput(input, '100:6');
	const point = dialog.getByRole('group', { name: 'Equalization curve', exact: true }).getByRole('button');
	await expect(point).toHaveAttribute('aria-label', /, 6\.0 dB$/u);
	await commitInput(input, '100:');
	await expect(input).toHaveAttribute('aria-invalid', 'true');
	await expect(point).toHaveAttribute('aria-label', /, 6\.0 dB$/u);
	await commitInput(input, '100:3');
	await expect(input).not.toHaveAttribute('aria-invalid', 'true');
	await expect(point).toHaveAttribute('aria-label', /, 3\.0 dB$/u);
});
