/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, sourcePeakChannels } from './audio-editor-test-helpers.js';
import { customTaggedWebmOpusFixture } from '../helpers/ordinary-ogg-opus-fixture.ts';

const custom = Object.freeze(Object.fromEntries([['constructor', 'Reviewed engineer'], ['toString', 'Reviewed producer'], ['__proto__', 'Reviewed source owner'], ['_ordinary', 'Control']]));

test('File Import and native Save retain Matroska private tag names with their audio', async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const file = await customTaggedWebmOpusFixture(custom); const buffer = Buffer.from(await file.arrayBuffer());
	for (const value of Object.values(custom)) expect(buffer.includes(Buffer.from(value))).toBe(true);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const peak = await sourcePeakChannels(page, file.name); expect(peak.channelCount).toBe(1);
	expect(peak.channels[0].maximum).toBeGreaterThan(.05);
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	const source = document.sources.find(source => source.name === file.name); expect(source.sampleRate).toBe(48_000);
	const contribution = source.provenance.contributions[0]; expect(contribution.warnings).toEqual([]);
	for (const [key, value] of Object.entries(custom)) expect(Object.getOwnPropertyDescriptor(contribution.metadata.raw, key)?.value).toBe(value);
});
