/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction } from './audio-editor-test-helpers.js';

for (const [name, albumTitle, expectedName] of [['Album.cue', '   ', 'Album'], ['   .cue', '', 'Labels']]) {
	test(`File Open imports CUE labels with a usable track name: ${JSON.stringify({ name, albumTitle })}`, async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const choosing = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await choosing).setFiles({ name, mimeType: 'application/x-cue', buffer: Buffer.from(
			`TITLE "${albumTitle}"\nFILE "Recording.wav" WAVE\nTRACK 01 AUDIO\n TITLE "Opening cue"\n INDEX 01 00:01:00\n`) });
		const destination = page.locator('[data-cue-import-choice]');
		await destination.getByRole('button', { name: 'Labels', exact: true }).click();
		const marker = editor.locator('[data-label-id]');
		await expect(marker).toHaveAttribute('aria-label', 'Edit labels: Opening cue');
		await expect(editor.locator('.track-control-panel__track-name-text').filter({ hasText: new RegExp(`^${expectedName}$`, 'u') })).toHaveCount(1);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(marker).toHaveCount(0);
		await chooseCommandAction(page, editor, 'Edit', 'Redo');
		await expect(marker).toHaveAttribute('aria-label', 'Edit labels: Opening cue');
	});
}
