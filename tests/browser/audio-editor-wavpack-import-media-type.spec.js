/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { createAudacityWavPackFixture } from '../helpers/wavpack-import-fixture.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

test('WavPack imported without a MIME hint retains its verified format when saved', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-import-input]').setInputFiles({ name: 'Room tone.wv', mimeType: '', buffer: Buffer.from(await createAudacityWavPackFixture()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const saving = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const download = await saving;
	let entries;
	try { entries = unzipSync(await downloadBytes(download)); } finally { await download.delete(); }
	const project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources[0]).toMatchObject({ name: 'Room tone.wv', mimeType: 'audio/wavpack' });
});
