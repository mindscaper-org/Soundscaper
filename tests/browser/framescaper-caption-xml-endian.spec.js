/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

for (const [encoding, marked] of [['UTF-8', false], ['UTF-16BE', true], ['UTF-16BE', false], ['UTF-16LE', false]]) {
	test(`Caption Tracks imports declared ${encoding} XML: BOM=${marked}`, async ({ page }) => {
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
		const dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
		const text = `<?xml version="1.0" encoding="${encoding}"?>`
			+ '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" '
			+ 'xml:id="captions" xml:lang="fr" xml:space="preserve" ttp:timeBase="media" '
			+ 'ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text" ttp:tickRate="1000">'
			+ '<body><div><p xml:id="cue" begin="0t" end="1000t">Élodie au café</p></div></body></tt>';
		const bytes = Buffer.from(text, encoding === 'UTF-8' ? 'utf8' : 'utf16le');
		if (encoding === 'UTF-16BE') bytes.swap16();
		const body = marked ? Buffer.concat([Buffer.from([254, 255]), bytes]) : bytes;
		await dialog.locator('[data-framescaper-caption-file]').setInputFiles({
			name: 'captions.ttml', mimeType: 'application/ttml+xml', buffer: body,
		});
		await expect(dialog.getByRole('status')).toHaveText('captions.ttml: No interchange losses.');
		const document = JSON.parse(await dialog.getByRole('textbox', {
			name: 'Canonical finishing document', exact: true,
		}).inputValue());
		expect(document[0].cues[0]).toMatchObject({ text: 'Élodie au café', startFrame: 0, endFrame: 48_000 });
	});
}
