/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, sourcePeakChannels } from './audio-editor-test-helpers.js';
import { createMultiValueWavPackFixture } from '../helpers/wavpack-import-fixture.ts';

test('WavPack File Import and native Save retain all NUL-separated APE performers', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const file = await createMultiValueWavPackFixture();
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const peak = await sourcePeakChannels(page, file.name);
	expect(peak.channelCount).toBe(2);
	expect(peak.channels[0].maximum).toBeCloseTo(.2, 3);
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	const contribution = document.sources[0].provenance.contributions[0];
	expect(contribution.warnings).toEqual([]);
	expect(contribution.metadata.normalized).toEqual({ title: 'Two credited performers', artist: 'Ada; Béla',
		comment: 'First note; Second note', trackNumber: 3, date: '2026-10-23' });
	expect(contribution.metadata.raw.ARTIST).toBe('Ada\0Béla');
	expect(contribution.metadata.raw.CUSTOM).toBe('One\0Two');
});
