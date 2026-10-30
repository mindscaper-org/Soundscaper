/* SPDX-License-Identifier: AGPL-3.0-only */

import { expectClipSampleRate, resampleClipFormat } from './audio-editor-clip-settings-test-helpers.js';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('clip format refuses an omitted sample rate without rewriting media', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const properties = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	await resampleClipFormat(properties, 24_000);
	const rate = properties.getByRole('spinbutton', { name: 'Sample rate (Hz)', exact: true });
	await rate.fill('');
	await expect(properties.getByRole('button', { name: 'Resample', exact: true })).toBeDisabled();
	await expect(properties.getByRole('button', { name: 'Reinterpret', exact: true })).toBeDisabled();
	await expect(properties.getByRole('alert')).toContainText('sample rate');
	await rate.fill('24000');
	await expectClipSampleRate(properties, 24_000);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expectClipSampleRate(properties, 48_000);
});
