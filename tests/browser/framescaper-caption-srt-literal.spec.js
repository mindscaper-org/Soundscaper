/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

for (const literal of [false, true]) test(`Caption Tracks safely delivers literal text: markup=${literal}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
	const dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
	const expected = literal ? '<b>Literal</b>' : 'Ordinary literal';
	const body = literal ? '&lt;b&gt;Literal&lt;/b&gt;' : expected;
	const xml = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" '
		+ 'xml:id="captions" xml:lang="en" xml:space="preserve" ttp:timeBase="media" '
		+ 'ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text" ttp:tickRate="1000">'
		+ `<body><div><p xml:id="cue" begin="0t" end="1000t">${body}</p></div></body></tt>`;
	await dialog.locator('[data-framescaper-caption-file]').setInputFiles({ name: 'Literal.ttml',
		mimeType: 'application/ttml+xml', buffer: Buffer.from(xml) });
	await expect(dialog.getByRole('status')).toHaveText('Literal.ttml: No interchange losses.');
	const document = dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true });
	expect(JSON.parse(await document.inputValue())[0].cues[0].text).toBe(expected);
	await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption('srt');
	if (literal) {
		let downloads = 0;
		page.on('download', () => { downloads += 1; });
		await dialog.getByRole('button', { name: 'Export selected track', exact: true }).click();
		await expect(dialog.getByRole('status')).toContainText('Caption cue markup is outside the passive maintained subset.');
		expect(downloads).toBe(0);
		expect(JSON.parse(await document.inputValue())[0].cues[0].text).toBe(expected);
		await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption('webvtt');
	}
	const downloading = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export selected track', exact: true }).click();
	const download = await downloading;
	const bytes = await downloadBytes(download);
	await download.delete();
	await dialog.locator('[data-framescaper-caption-file]').setInputFiles({ name: literal ? 'Delivered.vtt' : 'Delivered.srt',
		mimeType: literal ? 'text/vtt' : 'application/x-subrip', buffer: Buffer.from(bytes) });
	await expect(dialog.getByRole('status')).toContainText('Delivered.');
	expect(JSON.parse(await document.inputValue())[0].cues[0].text).toBe(expected);
});
