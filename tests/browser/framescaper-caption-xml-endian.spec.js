/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

// UTF-16 variants retain controller/store/Scape/sidecar coverage in
// framescaper-caption-archive-custody.test.ts; keep the actual file-input UI here.
test('Caption Tracks imports declared UTF-8 XML: BOM=false', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
	const dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
	const text = '<?xml version="1.0" encoding="UTF-8"?>'
		+ '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" '
		+ 'xml:id="captions" xml:lang="fr" xml:space="preserve" ttp:timeBase="media" '
		+ 'ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text" ttp:tickRate="1000">'
		+ '<body><div><p xml:id="cue" begin="0t" end="1000t">Élodie au café</p></div></body></tt>';
	await dialog.locator('[data-framescaper-caption-file]').setInputFiles({
		name: 'captions.ttml', mimeType: 'application/ttml+xml', buffer: Buffer.from(text),
	});
	await expect(dialog.getByRole('status')).toHaveText('captions.ttml: No interchange losses.');
	await expect(dialog.getByRole('textbox', { name: 'Track ID', exact: true })).toHaveValue('captions');
	await expect(dialog.getByRole('textbox', { name: 'Language', exact: true })).toHaveValue('fr');
	const document = JSON.parse(await dialog.getByRole('textbox', {
		name: 'Canonical finishing document', exact: true,
	}).inputValue());
	expect(document[0].cues[0]).toMatchObject({ text: 'Élodie au café', startFrame: 0, endFrame: 48_000 });
});
