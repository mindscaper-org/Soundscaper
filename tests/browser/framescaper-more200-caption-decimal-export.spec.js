/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

test('Caption Tracks can reimport its own saved decimal region position', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
	const dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
	const text = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" '
		+ 'xmlns:tts="http://www.w3.org/ns/ttml#styling" xml:id="captions" xml:space="preserve" '
		+ 'ttp:timeBase="media" ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text" ttp:tickRate="1000">'
		+ '<head><layout><region xml:id="lower" tts:origin="0.0000001% 70%" tts:extent="80% 20%" '
		+ 'tts:displayAlign="after"/></layout></head><body><div><p xml:id="cue" region="lower" '
		+ 'begin="0t" end="1000t">Preserve this caption</p></div></body></tt>';
	const input = dialog.locator('[data-framescaper-caption-file]');
	await input.setInputFiles({ name: 'original.ttml', mimeType: 'application/ttml+xml', buffer: Buffer.from(text) });
	const document = dialog.locator('[data-framescaper-finishing-document]');
	await expect(document).toHaveValue(/"xPercent": 1e-7/u);
	const original = await document.inputValue();
	const downloading = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export selected track', exact: true }).click();
	const exported = await downloadBytes(await downloading);
	await expect(dialog.getByRole('button', { name: 'Export selected track', exact: true })).toBeEnabled();
	await input.setInputFiles({ name: 'reopened.ttml', mimeType: 'application/ttml+xml', buffer: Buffer.from(exported) });
	await expect(dialog.getByRole('status')).toContainText('reopened.ttml:');
	await expect(document).toHaveValue(original);
	expect(Buffer.from(exported).toString()).toContain('tts:origin="0.0000001% 70%"');
});
