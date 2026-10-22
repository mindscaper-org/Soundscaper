/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

for (const separator of [' ', '\t']) test(`Caption Tracks reads the standard ${JSON.stringify(separator)} voice separator`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const body = `<b><v${separator}Alex>Hello</v></b>`;
	const reference = await page.evaluate(text => {
		const html = new VTTCue(0, 1, text).getCueAsHTML();
		return { text: html.textContent, speaker: html.querySelector('span')?.title, bold: html.querySelector('b')?.textContent };
	}, body);
	expect(reference).toEqual({ text: 'Hello', speaker: 'Alex', bold: 'Hello' });
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
	const dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
	await dialog.locator('[data-framescaper-caption-file]').setInputFiles({ name: 'Dialogue.vtt', mimeType: 'text/vtt',
		buffer: Buffer.from(`WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n${body}\n`) });
	await expect(dialog.locator('[data-framescaper-finishing-document]')).toHaveValue(/"name": "Alex"/u);
	const tracks = JSON.parse(await dialog.locator('[data-framescaper-finishing-document]').inputValue());
	expect(tracks[0].cues[0].text).toBe(reference.text);
	expect(tracks[0].speakers[0].name).toBe(reference.speaker);
	expect(tracks[0].styles[0].fontWeight).toBe('bold');
	await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption('webvtt');
	const downloading = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Export selected track', exact: true }).click();
	const exported = new TextDecoder().decode(await downloadBytes(await downloading));
	expect(exported).toContain('<v Alex>'); expect(exported).toContain('<b>Hello</b>');
});
