/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('a supported fractional keyframe anchor can switch to Bezier without losing its exact clock', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('Fractional curve.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u }); await clip.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Video keyframes']);
	const dialog = page.getByRole('dialog', { name: 'Video keyframes', exact: true });
	await dialog.getByRole('combobox', { name: 'Target', exact: true }).selectOption({ label: 'Opacity' });
	await dialog.getByRole('textbox', { name: 'Start (frames or num/den)', exact: true }).fill('1/999983');
	await dialog.getByRole('textbox', { name: 'End (frames or num/den)', exact: true }).fill('1');
	await dialog.getByRole('spinbutton', { name: 'Start value', exact: true }).fill('0.2');
	await dialog.getByRole('spinbutton', { name: 'End value', exact: true }).fill('0.8');
	await dialog.getByRole('button', { name: 'Add curve', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Video keyframes applied.');
	await dialog.locator('[data-video-keyframe-field="segment-kind"]').selectOption('bezier');
	await expect(dialog.getByRole('textbox', { name: 'Control 1 position', exact: true })).toHaveValue(/\d/u);
	await dialog.getByRole('button', { name: 'Update segment', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Video keyframes applied.');
	await dialog.getByRole('button', { name: 'Copy curve', exact: true }).click();
	const transfer = JSON.parse(await dialog.getByRole('textbox', { name: 'Curve transfer JSON', exact: true }).inputValue());
	expect(transfer.curve.anchors.map(anchor => anchor.position)).toEqual([{ num: 1, den: 999983 }, { num: 1, den: 1 }]);
	expect(transfer.curve.segments[0].kind).toBe('bezier');
});
