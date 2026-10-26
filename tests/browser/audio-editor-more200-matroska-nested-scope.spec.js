/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, sourcePeakChannels } from './audio-editor-test-helpers.js';
import { originalWorkTaggedWebmOpusFixture } from '../helpers/ordinary-ogg-opus-fixture.ts';

for (const originalFirst of [false, true]) test(`File Import attributes this recording to its own artist, independent of ORIGINAL nesting order=${originalFirst}`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const file = await originalWorkTaggedWebmOpusFixture(originalFirst);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const peak = await sourcePeakChannels(page, file.name); expect(peak.channelCount).toBe(1);
	expect(peak.channels[0].maximum).toBeGreaterThan(.05);
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	const source = document.sources.find(source => source.name === file.name); expect(source.sampleRate).toBe(48_000);
	const contribution = source.provenance.contributions[0]; expect(contribution.warnings).toEqual([]);
	expect(contribution.metadata.normalized.artist).toBe('Current performer');
	expect(contribution.metadata.normalized.title).toBe('Current title');
	expect(contribution.metadata.raw.ARTIST).toEqual(originalFirst
		? { 0: 'Original performer', 1: 'Current performer' } : { 0: 'Current performer', 1: 'Original performer' });
});
