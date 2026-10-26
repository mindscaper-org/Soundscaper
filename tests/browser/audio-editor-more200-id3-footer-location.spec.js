/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { footerTaggedMp3Fixture } from '../helpers/ordinary-cover-mp3-fixture.ts';

for (const legacy of [false, true]) test(`File Import retains MP3 footer-tag metadata before native Save (legacy=${legacy})`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const file = await footerTaggedMp3Fixture(legacy);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading));
	const document = JSON.parse(strFromU8(entries['project.json']));
	const contribution = document.sources[0].provenance.contributions[0];
	expect(contribution.warnings).toEqual([]);
	expect(contribution.metadata.normalized.title).toBe('Footer title');
	expect(contribution.metadata.normalized.artist).toBe('Footer performer');
	expect(contribution.metadata.raw.TIT2).toBe('Footer title');
	expect(document.sources[0]).toMatchObject({ sampleRate: 48_000, channelCount: 1 });
});
