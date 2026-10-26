/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

for (const explicit of [false, true]) test(`Caption Tracks retains the ${explicit ? 'explicit' : 'initial'} IMSC background and alignment`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
	const dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
	const text = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" '
		+ 'xmlns:tts="http://www.w3.org/ns/ttml#styling" xml:id="captions" xml:lang="en" xml:space="preserve" '
		+ 'ttp:timeBase="media" ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text">'
		+ `<head><styling><style xml:id="spoken" tts:fontSize="75%"${explicit ? ' tts:backgroundColor="#000000cc" tts:textAlign="center"' : ''}/></styling></head>`
		+ '<body><div><p xml:id="cue" style="spoken" begin="00:00:00" end="00:00:01">Dialogue</p></div></body></tt>';
	await dialog.locator('[data-framescaper-caption-file]').setInputFiles({ name: 'dialogue.ttml', mimeType: 'application/ttml+xml', buffer: Buffer.from(text) });
	const document = dialog.locator('[data-framescaper-finishing-document]');
	await expect(document).toHaveValue(/Dialogue/u);
	await expect(document).toHaveValue(new RegExp(`"backgroundColor": "${explicit ? '#000000cc' : '#00000000'}"`, 'u'));
	await expect(document).toHaveValue(new RegExp(`"textAlign": "${explicit ? 'center' : 'start'}"`, 'u'));
	await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption('imsc1.1');
	const downloading = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export selected track', exact: true }).click();
	const exported = Buffer.from(await downloadBytes(await downloading)).toString();
	expect(exported).toContain(`tts:backgroundColor="${explicit ? '#000000cc' : '#00000000'}"`);
	expect(exported).toContain(`tts:textAlign="${explicit ? 'center' : 'start'}"`);
	expect(exported).toContain('Dialogue');
});
