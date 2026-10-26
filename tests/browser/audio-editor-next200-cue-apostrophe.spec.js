/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, chooseFileAction,
	disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

for (const [quoted, title] of [[false, "'97"], [false, "'"], [true, "'97"]]) {
	test(`File Import preserves a ${quoted ? 'quoted' : 'bare'} CUE title ${JSON.stringify(title)}`, async ({ page }) => {
		await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
		const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Import');
		await (await choosing).setFiles({ name: 'Album.cue', mimeType: 'application/x-cue', buffer: Buffer.from(
			`FILE Programme.wav WAVE\nTRACK 01 AUDIO\n TITLE ${quoted ? `"${title}"` : title}\n INDEX 01 00:00:01\n`) });
		await page.locator('[data-cue-import-choice]').getByRole('button', { name: 'Labels', exact: true }).click();
		const label = editor.locator('[data-label-id]');
		await expect(label).toHaveAttribute('aria-label', `Edit labels: ${title}`);
		await chooseCommandAction(page, editor, 'Edit', 'Undo'); await expect(label).toHaveCount(0);
		await chooseCommandAction(page, editor, 'Edit', 'Redo'); await expect(label).toHaveAttribute('aria-label', `Edit labels: ${title}`);
		const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
		const archive = unzipSync(await downloadBytes(await saving));
		const project = JSON.parse(strFromU8(archive['project.json']));
		const saved = project.tracks.flatMap(track => track.type === 'label' ? track.labels : []);
		expect(saved).toHaveLength(1); expect(saved[0]).toMatchObject({ title, startFrame: 640, endFrame: 640 });
	});
}
