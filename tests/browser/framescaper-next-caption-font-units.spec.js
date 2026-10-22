/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

test('Caption Tracks imports a normal IMSC percentage font in root-height units', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
	const dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
	const text = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" '
		+ 'xmlns:tts="http://www.w3.org/ns/ttml#styling" xml:id="captions" xml:lang="en" xml:space="preserve" '
		+ 'ttp:timeBase="media" ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text" ttp:tickRate="1000">'
		+ '<head><styling><style xml:id="spoken" tts:fontSize="75%"/></styling></head>'
		+ '<body><div><p xml:id="cue" style="spoken" begin="0t" end="1000t">Readable caption</p></div></body></tt>';
	await dialog.locator('[data-framescaper-caption-file]').setInputFiles({
		name: 'dialogue.ttml', mimeType: 'application/ttml+xml', buffer: Buffer.from(text),
	});
	await expect(dialog.locator('[data-framescaper-finishing-document]')).toHaveValue(/"fontSizePercent": 5,/u);
	await expect(dialog.locator('[data-framescaper-finishing-document]')).toHaveValue(/Readable caption/u);
});

test('Caption Tracks exports its readable SRT emphasis at the same IMSC font size', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
	const dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
	await dialog.locator('[data-framescaper-caption-file]').setInputFiles({
		name: 'dialogue.srt', mimeType: 'application/x-subrip',
		buffer: Buffer.from('1\n00:00:00,000 --> 00:00:01,000\n<b>Readable caption</b>\n'),
	});
	await expect(dialog.locator('[data-framescaper-finishing-document]')).toHaveValue(/"fontSizePercent": 5,/u);
	await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption('imsc1.1');
	const downloading = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export selected track', exact: true }).click();
	const exported = Buffer.from(await downloadBytes(await downloading)).toString();
	expect(exported).toContain('tts:fontSize="75%"');
	expect(exported).toContain('Readable caption');
});
