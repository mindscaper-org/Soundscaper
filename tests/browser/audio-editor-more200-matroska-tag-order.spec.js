/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, sourcePeakChannels, chooseFileAction } from './audio-editor-test-helpers.js';
import { reorderedTaggedWebmOpusFixture } from '../helpers/ordinary-ogg-opus-fixture.ts';

// Node retains each variant through controller import and independent archive reopen.
test('Matroska tag orders retain scoped credits through browser Import and Save', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const cases = [];
	for (const mode of ['name-first', 'value-first', 'targets-last']) {
		const original = await reorderedTaggedWebmOpusFixture(mode);
		const file = new File([await original.arrayBuffer()], `Credits-${mode}.webm`, { type: original.type });
		cases.push({ mode, file });
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
	for (const { mode, file } of cases) {
		const source = document.sources.find(source => source.name === file.name); expect(source.sampleRate).toBe(48_000);
		const contribution = source.provenance.contributions[0]; expect(contribution.warnings).toEqual([]);
		if (mode === 'targets-last') {
			expect(contribution.metadata.normalized).toEqual({}); expect(contribution.metadata.raw).toEqual({});
		} else {
			expect(contribution.metadata.normalized.artist).toBe('Ada'); expect(contribution.metadata.raw.ARTIST).toBe('Ada');
		}
	}
});
