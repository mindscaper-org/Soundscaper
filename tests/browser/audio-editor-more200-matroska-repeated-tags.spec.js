/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, sourcePeakChannels } from './audio-editor-test-helpers.js';
import { repeatedTaggedWebmOpusFixture } from '../helpers/ordinary-ogg-opus-fixture.ts';

test('File Import and native Save retain all separate Matroska performer credits', async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const file = await repeatedTaggedWebmOpusFixture();
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const peak = await sourcePeakChannels(page, file.name); expect(peak.channelCount).toBe(1);
	expect(peak.channels[0].maximum).toBeGreaterThan(.05);
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	const source = document.sources.find(source => source.name === file.name); expect(source.sampleRate).toBe(48_000);
	const contribution = source.provenance.contributions[0]; expect(contribution.warnings).toEqual([]);
	expect(contribution.metadata.normalized.artist).toBe('Ada; Grace; Ada');
	expect(contribution.metadata.raw.ARTIST).toEqual({ 0: 'Ada', 1: 'Grace', 2: 'Ada' });
	expect(contribution.metadata.normalized.trackNumber).toBe(2);
	expect(contribution.metadata.normalized.comment).toBe('After credits');
});
