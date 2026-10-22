/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('Caption Tracks can reimport an unchanged sidecar and still accept a later update', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
	const dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
	const text = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" '
		+ 'xml:id="captions" xml:lang="en" xml:space="preserve" ttp:timeBase="media" '
		+ 'ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text" ttp:tickRate="1000">'
		+ '<body><div><p xml:id="cue" begin="0t" end="1000t">Speech</p></div></body></tt>';
	const chooser = async (name, content) => {
		const choosing = page.waitForEvent('filechooser');
		await dialog.getByRole('button', { name: 'Choose sidecar file', exact: true }).click();
		await (await choosing).setFiles({ name, mimeType: 'application/ttml+xml', buffer: Buffer.from(content) });
		await expect(dialog.getByRole('status').last()).toContainText(`${name}:`);
	};
	await chooser('first.ttml', text);
	await chooser('same.ttml', text);
	await chooser('updated.ttml', text.replace('Speech', 'Updated speech'));
	await expect(dialog.locator('[data-framescaper-finishing-document]')).toHaveValue(/Updated speech/u);
});
