/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { repeatedVorbisCommentsFixture } from '../helpers/repeated-vorbis-comments-fixture.ts';

for (const format of ['flac', 'ogg-vorbis', 'opus']) test(`File Import and native Save retain every repeated ${format} artist credit`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const file = await repeatedVorbisCommentsFixture(format);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading));
	const document = JSON.parse(strFromU8(entries['project.json']));
	const contribution = document.sources[0].provenance.contributions[0];
	expect(contribution.warnings).toEqual([]);
	expect(contribution.metadata.normalized.artist).toBe('Ada; Grace; Ada');
	expect(contribution.metadata.raw.ARTIST).toEqual({ 0: 'Ada', 1: 'Grace', 2: 'Ada' });
	expect(contribution.metadata.raw.PERFORMER).toEqual({ 0: 'First chair', 1: 'Second chair' });
	expect(contribution.metadata.normalized.trackNumber).toBe(2);
	expect(Object.keys(entries).some(name => name.endsWith('.f32c'))).toBe(true);
});
