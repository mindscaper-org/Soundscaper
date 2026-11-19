/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { repeatedVorbisCommentsFixture } from '../helpers/repeated-vorbis-comments-fixture.ts';

test('File Import and native Save retain repeated credits for FLAC, Vorbis and Opus', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const formats = ['flac', 'ogg-vorbis', 'opus'];
	for (const [index, format] of formats.entries()) {
		const file = await repeatedVorbisCommentsFixture(format);
		await editor.locator('[data-import-input]').setInputFiles({ name: `${format}-${file.name}`, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-clip-count', String(index + 1), { timeout: 30_000 });
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	}
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading));
	const document = JSON.parse(strFromU8(entries['project.json']));
	expect(document.sources).toHaveLength(3);
	for (const format of formats) {
		const source = document.sources.find(source => source.name.startsWith(`${format}-`));
		expect(source).toMatchObject({ sampleRate: 48_000, channelCount: 1, frameCount: 4800 });
		const contribution = source.provenance.contributions[0];
		expect(contribution.warnings).toEqual([]);
		expect(contribution.metadata.normalized.artist).toBe('Ada; Grace; Ada');
		expect(contribution.metadata.raw.ARTIST).toEqual({ 0: 'Ada', 1: 'Grace', 2: 'Ada' });
		expect(contribution.metadata.raw.PERFORMER).toEqual({ 0: 'First chair', 1: 'Second chair' });
		expect(contribution.metadata.normalized.trackNumber).toBe(2);
		expect(entries[`audio/${source.id}.f32c`]).toBeDefined();
	}
});
