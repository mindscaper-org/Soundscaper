/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, sourcePeakChannels } from './audio-editor-test-helpers.js';
import { metadataKeyOrderM4aFixture } from '../helpers/ordinary-tail-m4a-fixture.ts';

test('File Import retains named MP4 metadata when its key table follows the values', async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const file = await metadataKeyOrderM4aFixture();
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const peak = await sourcePeakChannels(page, file.name); expect(peak.channels[0].maximum).toBeGreaterThan(.005);
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	const contribution = document.sources.find(source => source.name === file.name).provenance.contributions[0];
	expect(contribution.metadata.normalized.title).toBe('Keyed programme title');
	expect(contribution.metadata.normalized.artist).toBe('Keyed performer');
	expect(contribution.metadata.raw.engineer).toBe('Retained engineering credit');
});
