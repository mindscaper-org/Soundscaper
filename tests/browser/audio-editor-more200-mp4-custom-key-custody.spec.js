/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, importFiles, openExportDialog, readDownloadBytes, sourcePeakChannels } from './audio-editor-test-helpers.js';
import { appMetadataM4aFixture } from '../helpers/ordinary-tail-m4a-fixture.ts';
const custom = Object.freeze(Object.fromEntries([['constructor', 'Reviewed engineer'], ['toString', 'Reviewed producer'], ['__proto__', 'Reviewed source owner'], ['ordinary', 'Control']]));

async function savedContribution(page, editor, name) {
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	return document.sources.find(source => source.name === name).provenance.contributions[0];
}

test('File Import retains valid MP4 custom metadata own keys', async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const file = await appMetadataM4aFixture(custom);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const contribution = await savedContribution(page, editor, file.name);
	expect(contribution.warnings).toEqual([]);
	for (const [key, value] of Object.entries(custom)) expect(Object.getOwnPropertyDescriptor(contribution.metadata.raw, key)?.value).toBe(value);
});

test('real native AAC export Custom Metadata survives reimport with its audio', async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const capability = await page.evaluate(async () => typeof AudioEncoder !== 'undefined' && (await AudioEncoder.isConfigSupported({
		codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 2, bitrate: 192_000 })).supported);
	test.skip(!capability, 'The maintained native AAC encoder is unavailable on this engine/platform.');
	await importFiles(editor, [createWavFixture({ name: 'Original.wav', frequency: 330, duration: .2, channelAmplitudes: [.3, .1] })]);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'AAC / M4A');
	await dialog.getByRole('button', { name: 'Metadata', exact: true }).click();
	const metadata = page.locator('[data-export-metadata-dialog]');
	await metadata.locator('summary').filter({ hasText: 'Additional metadata (JSON)' }).click();
	await metadata.getByRole('textbox', { name: 'Additional metadata (JSON)', exact: true }).fill(JSON.stringify(custom));
	await metadata.getByRole('button', { name: 'Done', exact: true }).click();
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 30_000 });
	const bytes = await readDownloadBytes(page, link);
	for (const value of Object.values(custom)) expect(Buffer.from(bytes).includes(Buffer.from(value))).toBe(true);
	await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
	await importFiles(editor, [{ name: 'Returned.m4a', mimeType: 'audio/mp4', buffer: Buffer.from(bytes) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	const peak = await sourcePeakChannels(page, 'Returned.m4a'); expect(peak.channelCount).toBe(2);
	expect(peak.channels[0].maximum).toBeGreaterThan(.2); expect(peak.channels[1].maximum).toBeGreaterThan(.05);
	const contribution = await savedContribution(page, editor, 'Returned.m4a');
	for (const [key, value] of Object.entries(custom)) expect(Object.getOwnPropertyDescriptor(contribution.metadata.raw, key)?.value).toBe(value);
});
