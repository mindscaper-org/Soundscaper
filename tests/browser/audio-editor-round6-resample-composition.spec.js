/* SPDX-License-Identifier: AGPL-3.0-only */

import { expectClipSampleRate, openClipResampleDialog, resampleClipFormat } from './audio-editor-clip-settings-test-helpers.js';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, closeWorkspacePanel, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('the clip resampling dialog keeps native composition as a draft until conversion is requested', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const properties = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	await resampleClipFormat(properties, 24_000);
	const dialog = await openClipResampleDialog(properties);
	const rate = dialog.getByRole('textbox');
	await rate.fill('32000');
	const prevented = await rate.evaluate(field => {
		const event = new KeyboardEvent('keydown', {
			key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true,
		});
		field.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(false);
	await expect(rate).toBeFocused();
	await expect(dialog).toBeVisible();
	await expect(rate).toHaveValue('32000');
	await expect(dialog.getByRole('button', { name: 'Resample', exact: true })).toBeEnabled();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expectClipSampleRate(properties, 24_000);
	await resampleClipFormat(properties, 48_000);
	await closeWorkspacePanel(editor, 'clip-properties');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const restored = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	await expectClipSampleRate(restored, 24_000);
});
