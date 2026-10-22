/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { ordinaryFramescaperImage } from '../helpers/framescaper-ordinary-animation-fixture.ts';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('browser bitmap fallback preserves animation admission', async ({ page }, testInfo) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	const capabilities = await page.evaluate(() => ({ decoder: typeof globalThis.ImageDecoder, bitmap: typeof createImageBitmap }));
	await testInfo.attach('native-image-capabilities.json', { body: JSON.stringify(capabilities), contentType: 'application/json' });
	test.skip(capabilities.decoder === 'function' || capabilities.bitmap !== 'function', 'This workflow uses the browser’s actual static-only fallback.');
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
	await (await chooser).setFiles({ name: 'animation.png', mimeType: 'image/png',
		buffer: ordinaryFramescaperImage('animated.png') });
	await expect(page.getByRole('alert').filter({ hasText: 'This animated image requires an available browser animation decoder.' })).toBeVisible();
	await expect(editor.getByRole('group', { name: 'Image clip: animation', exact: true })).toHaveCount(0);
});
