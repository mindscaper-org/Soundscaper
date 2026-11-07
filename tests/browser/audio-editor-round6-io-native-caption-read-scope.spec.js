/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { installNativeCaptionSidecar } from './helpers/native-caption-sidecar.js';

const text = '1\n00:00:00,100 --> 00:00:00,500\nA normal caption\n\n';

// Node checks both file transports through canonical caption parsing and export.
test('Caption Tracks reads native SRT dialogue within its selected-range lease', async ({ page }) => {
	const native = await installNativeCaptionSidecar(page, 'dialogue.srt', text);
	try {
		const editor = await bootEditor(page, '/framescaper/en/');
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
		const dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
		await dialog.getByRole('button', { name: 'Choose sidecar file', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText('dialogue.srt: No interchange losses.');
		const document = JSON.parse(await dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true }).inputValue());
		expect(document[0].cues[0].text).toBe('A normal caption');
		expect(native.releases).toHaveLength(1);
	} finally { await native.close(); }
});
