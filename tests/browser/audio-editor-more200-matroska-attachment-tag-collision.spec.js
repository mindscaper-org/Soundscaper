/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, sourcePeakChannels } from './audio-editor-test-helpers.js';
import { attachmentCollisionWebmOpusFixture } from '../helpers/ordinary-ogg-opus-fixture.ts';

for (const tagsFirst of [false, true]) for (const collision of [false, true]) test(`File Import and native Save retain separate Matroska tag and attachment identities (collision=${collision}, tagsFirst=${tagsFirst})`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const file = await attachmentCollisionWebmOpusFixture(collision, tagsFirst);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const peak = await sourcePeakChannels(page, file.name); expect(peak.channels[0].maximum).toBeGreaterThan(.05);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing', { timeout: 30_000 });
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	const source = document.sources.find(source => source.name === file.name); expect(source.sampleRate).toBe(48_000);
	const contribution = source.provenance.contributions[0]; expect(contribution.warnings).toEqual([]);
	expect(contribution.metadata.raw[collision ? '123' : '_23']).toBe('Reviewed archive credit');
	expect(contribution.metadata.raw['attachment:123']).toBe('Existing private escape-name control');
	expect(contribution.attachments).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'licence.txt', byteLength: 27 })]));
});
