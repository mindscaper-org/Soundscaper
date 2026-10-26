/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

test('Caption File import and export retain case-sensitive named-reference dialogue', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const lines = ['Literal &NBSP; &NbSp; &LRM; &RLM; &APOS; &AmP;',
		'Known &AMP; &LT; &GT; &QUOT;', 'Escaped &amp;NBSP; &amp;LRM; &amp;amp;'];
	const nativeTexts = await page.evaluate(values => values.map(value => new VTTCue(0, 1, value).getCueAsHTML().textContent), lines);
	expect(nativeTexts).toEqual([lines[0], 'Known & < > "', 'Escaped &NBSP; &LRM; &amp;']);
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
	const dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
	const vtt = `WEBVTT\n\n${lines.map((text, index) =>
		`line-${index}\n00:00:0${index}.000 --> 00:00:0${index + 1}.000\n${text}\n`).join('\n')}`;
	await dialog.locator('[data-framescaper-caption-file]').setInputFiles({ name: 'Dialogue.vtt', mimeType: 'text/vtt', buffer: Buffer.from(vtt) });
	await expect(dialog.locator('[data-framescaper-finishing-document]')).toHaveValue(/"line-2"/u);
	const track = JSON.parse(await dialog.locator('[data-framescaper-finishing-document]').inputValue())[0];
	expect(track.cues.map(cue => cue.text)).toEqual(nativeTexts);
	await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption('webvtt');
	const downloading = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export selected track', exact: true }).click();
	const output = new TextDecoder().decode(await downloadBytes(await downloading));
	const exportedTexts = await page.evaluate(text => text.trim().split(/\n\n/u).slice(1)
		.map(block => new VTTCue(0, 1, block.split('\n').slice(2).join('\n')).getCueAsHTML().textContent), output);
	expect(exportedTexts).toEqual(nativeTexts);
});
