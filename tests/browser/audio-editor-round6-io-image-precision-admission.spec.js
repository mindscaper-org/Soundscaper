/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { ordinaryHighPrecisionPng } from '../helpers/framescaper-ordinary-high-precision-image-fixture.ts';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

// The native raster batch owns the ordinary 8-bit PNG import/save/reload control.
test('ordinary 16-bit PNG refuses native quantization before image publication', async ({ page }, testInfo) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	const bytes = ordinaryHighPrecisionPng();
	expect(bytes[24]).toBe(16);
	await testInfo.attach('ordinary-png.png', { body: bytes, contentType: 'image/png' });
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
	await (await chooser).setFiles({ name: 'ordinary.png', mimeType: 'image/png', buffer: bytes });
	await expect(page.getByRole('alert').filter({ hasText: 'High-precision 16-bit PNG requires a verified image normalization route.' })).toBeVisible();
	await expect(editor.getByRole('group', { name: 'Image clip: ordinary', exact: true })).toHaveCount(0);
});
