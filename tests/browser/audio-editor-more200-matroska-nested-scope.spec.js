/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, sourcePeakChannels, chooseFileAction } from './audio-editor-test-helpers.js';
import { originalWorkTaggedWebmOpusFixture } from '../helpers/ordinary-ogg-opus-fixture.ts';

// Node retains each variant through controller import and independent archive reopen.
test('Matroska nested ORIGINAL orders retain recording credits through browser Import and Save', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const cases = [];
	for (const originalFirst of [false, true]) {
		const original = await originalWorkTaggedWebmOpusFixture(originalFirst);
		const file = new File([await original.arrayBuffer()], `Credits-${originalFirst}.webm`, { type: original.type });
		cases.push({ originalFirst, file });
	}
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles(await Promise.all(cases.map(async ({ file }) => ({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) }))));
	await expect(editor).toHaveAttribute('data-clip-count', String(cases.length), { timeout: 30_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	for (const { file } of cases) {
		await expect.poll(async () => (await sourcePeakChannels(page, file.name)).channelCount).toBe(1);
		const peak = await sourcePeakChannels(page, file.name); expect(peak.channelCount).toBe(1);
		expect(peak.channels[0].maximum).toBeGreaterThan(.05);
	}
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	expect(document.sources).toHaveLength(cases.length);
	for (const { originalFirst, file } of cases) {
		const source = document.sources.find(source => source.name === file.name); expect(source.sampleRate).toBe(48_000);
		const contribution = source.provenance.contributions[0]; expect(contribution.warnings).toEqual([]);
		expect(contribution.metadata.normalized.artist).toBe('Current performer');
		expect(contribution.metadata.normalized.title).toBe('Current title');
		expect(contribution.metadata.raw.ARTIST).toEqual(originalFirst
			? { 0: 'Original performer', 1: 'Current performer' } : { 0: 'Current performer', 1: 'Original performer' });
	}
});
