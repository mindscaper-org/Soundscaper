/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

test('Caption Tracks imports and immediately exports a private-use TTML language unchanged', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
	const dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
	const text = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" '
		+ 'xml:id="studio" xml:lang="x-studio" xml:space="preserve" ttp:timeBase="media" '
		+ 'ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text" ttp:tickRate="1000">'
		+ '<body><div><p xml:id="cue" begin="0t" end="1000t">Speech</p></div></body></tt>';
	await dialog.locator('[data-framescaper-caption-file]').setInputFiles({
		name: 'studio.ttml', mimeType: 'application/ttml+xml', buffer: Buffer.from(text),
	});
	await expect(dialog.getByRole('textbox', { name: 'Track ID', exact: true })).toHaveValue('studio');
	await expect(dialog.getByRole('textbox', { name: 'Language', exact: true })).toHaveValue('x-studio');
	const downloading = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export selected track', exact: true }).click();
	expect(Buffer.from(await downloadBytes(await downloading)).toString()).toContain('xml:lang="x-studio"');
});
