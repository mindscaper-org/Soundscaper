/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

async function setup(page) {
	const editor = await bootEditor(page, '/framescaper/en/');
	await importFiles(editor, [createDeterministicAvFixture('curve-admission.webm')]);
	await editor.getByRole('group', { name: /^Video clip:/u }).press('Enter');
	const open = async () => {
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Video keyframes']);
		return page.getByRole('dialog', { name: 'Video keyframes', exact: true });
	};
	const dialog = await open();
	await dialog.getByRole('combobox', { name: 'Target', exact: true }).selectOption({ label: 'Scale X' });
	await dialog.getByRole('spinbutton', { name: 'End value', exact: true }).fill('1.2');
	await dialog.getByRole('button', { name: 'Add curve', exact: true }).focus();
	await dialog.getByRole('button', { name: 'Add curve', exact: true }).press('Enter');
	await expect(dialog.getByRole('combobox', { name: 'Curve', exact: true })).toHaveValue(JSON.stringify(['composition', 'transform.scaleX']));
	await expect(dialog.getByRole('button', { name: 'Add curve', exact: true })).toBeDisabled();
	await expect(dialog.getByRole('combobox', { name: 'Target', exact: true })).toBeFocused();
	return { editor, dialog, open };
}

async function copiedValues(dialog) {
	await dialog.getByRole('button', { name: 'Copy curve', exact: true }).click();
	const wire = JSON.parse(await dialog.getByRole('textbox', { name: 'Curve transfer JSON', exact: true }).inputValue());
	return wire.curve.anchors.map(anchor => anchor.value);
}

test('an existing default keyframe target declines Add while retaining edit, paste, and removal', async ({ page }) => {
	const { open, dialog } = await setup(page);
	await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
	await open();
	const target = dialog.getByRole('combobox', { name: 'Target', exact: true });
	await expect(target).toHaveValue(JSON.stringify(['composition', 'transform.scaleX']));
	await expect(target).toBeEnabled();
	await expect(dialog.getByRole('button', { name: 'Add curve', exact: true })).toBeDisabled();
	expect(await copiedValues(dialog)).toEqual([1, 1.2]);
	await dialog.getByRole('spinbutton', { name: 'Value', exact: true }).fill('1.5');
	await dialog.getByRole('button', { name: 'Update anchor', exact: true }).click();
	expect(await copiedValues(dialog)).toEqual([1.5, 1.2]);
	await dialog.getByRole('button', { name: 'Paste curve', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Video keyframes applied.');
	await expect(dialog.getByRole('button', { name: 'Add curve', exact: true })).toBeDisabled();
	await dialog.getByRole('button', { name: 'Remove curve', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Add curve', exact: true })).toBeEnabled();
	await dialog.getByRole('button', { name: 'Add curve', exact: true }).focus();
	await dialog.getByRole('button', { name: 'Add curve', exact: true }).press('Enter');
	await expect(dialog.getByRole('button', { name: 'Add curve', exact: true })).toBeDisabled();
	await expect(target).toBeFocused();
});

test('a new target saves exact curve data and history restores its Add eligibility', async ({ page }) => {
	const { editor, open, dialog } = await setup(page);
	const target = dialog.getByRole('combobox', { name: 'Target', exact: true });
	await target.selectOption({ label: 'Opacity' });
	await expect(dialog.getByRole('button', { name: 'Add curve', exact: true })).toBeEnabled();
	await dialog.getByRole('spinbutton', { name: 'Start value', exact: true }).fill('.25');
	await dialog.getByRole('spinbutton', { name: 'End value', exact: true }).fill('.75');
	await dialog.getByRole('button', { name: 'Add curve', exact: true }).focus();
	await dialog.getByRole('button', { name: 'Add curve', exact: true }).press('Enter');
	await expect(target).toHaveValue(JSON.stringify(['composition', 'opacity']));
	await expect(dialog.getByRole('button', { name: 'Add curve', exact: true })).toBeDisabled();
	await dialog.getByRole('combobox', { name: 'Curve', exact: true }).selectOption({ label: 'Opacity' });
	expect(await copiedValues(dialog)).toEqual([.25, .75]);
	await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
	await chooseCommandAction(page, editor, 'Edit', 'Undo'); await open();
	await target.selectOption({ label: 'Opacity' });
	await expect(dialog.getByRole('button', { name: 'Add curve', exact: true })).toBeEnabled();
	await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
	await chooseCommandAction(page, editor, 'Edit', 'Redo'); await open();
	await target.selectOption({ label: 'Opacity' });
	await expect(dialog.getByRole('button', { name: 'Add curve', exact: true })).toBeDisabled();
	await dialog.getByRole('combobox', { name: 'Curve', exact: true }).selectOption({ label: 'Opacity' });
	expect(await copiedValues(dialog)).toEqual([.25, .75]);
});
