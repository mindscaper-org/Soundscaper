/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, sourcePeakChannels } from './audio-editor-test-helpers.js';
import { reorderedTaggedWebmOpusFixture } from '../helpers/ordinary-ogg-opus-fixture.ts';

for (const mode of ['name-first', 'value-first', 'targets-last']) test(`File Import respects Matroska tag fields in valid ${mode} order`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const file = await reorderedTaggedWebmOpusFixture(mode);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const peak = await sourcePeakChannels(page, file.name); expect(peak.channelCount).toBe(1); expect(peak.channels[0].maximum).toBeGreaterThan(.05);
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	const source = document.sources.find(source => source.name === file.name); expect(source.sampleRate).toBe(48_000);
	const contribution = source.provenance.contributions[0]; expect(contribution.warnings).toEqual([]);
	if (mode === 'targets-last') {
		expect(contribution.metadata.normalized).toEqual({}); expect(contribution.metadata.raw).toEqual({});
	} else {
		expect(contribution.metadata.normalized.artist).toBe('Ada'); expect(contribution.metadata.raw.ARTIST).toBe('Ada');
	}
});
