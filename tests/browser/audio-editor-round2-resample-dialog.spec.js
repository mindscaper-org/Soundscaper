/* SPDX-License-Identifier: AGPL-3.0-only */

import { expectClipSampleRate, openClipResampleDialog, resampleClipFormat } from './audio-editor-clip-settings-test-helpers.js';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { EFFECT_PARAMETER_COPY_BY_LOCALE } from '../../src/common/i18n/effect-parameter-copy.js';

test('clip resampling refuses an omitted sample rate without rewriting media', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const properties = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	await resampleClipFormat(properties, 24_000);
	const dialog = await openClipResampleDialog(properties);
	const rate = dialog.getByRole('textbox');
	await expect(rate).toHaveValue('24000');
	await rate.fill('');
	await expect(dialog.getByRole('button', { name: 'Resample', exact: true })).toBeDisabled();
	await expect(dialog.getByRole('alert')).toHaveText(EFFECT_PARAMETER_COPY_BY_LOCALE.en.invalidClipSampleRate);
	await rate.fill('24000');
	await expect(dialog.getByRole('button', { name: 'Resample', exact: true })).toBeEnabled();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expectClipSampleRate(properties, 24_000);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expectClipSampleRate(properties, 48_000);
});
