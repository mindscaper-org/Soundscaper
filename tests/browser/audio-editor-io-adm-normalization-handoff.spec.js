/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, collectClientErrors, disableNativeSavePicker, importFiles, openExportDialog } from './audio-editor-test-helpers.js';
import { createAdmChna, encodeChnaPayload, generateAdmAxml } from '../../src/common/editor/adm-metadata.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';

for (const priorTarget of [false, true]) test(`BW64 passthrough retires an incompatible mix loudness target=${priorTarget}`, async ({ page }) => {
	const samples = Float32Array.from({ length: 4800 }, (_, frame) => .25 * Math.sin(2 * Math.PI * 500 * frame / 48_000));
	const bytes = encodeWav([samples, samples], { container: 'bw64', sampleRate: 48_000, bitDepth: 16, dither: false,
		preDataChunks: [
			chunk('chna', encodeChnaPayload(createAdmChna({ layout: 'stereo' }))),
			chunk('axml', new TextEncoder().encode(generateAdmAxml({ layout: 'stereo', programmeName: 'Recorded master' }))),
		] });
	const original = await inspectWavBlobPcm(new Blob([bytes]));
	expect(original.adm?.valid).toBe(true);
	const errors = collectClientErrors(page);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	// A pristine pass-through intentionally excludes authored import microfades.
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await preferences.getByRole('checkbox', { name: 'Apply 2 ms fades to new clips' }).uncheck();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await importFiles(editor, [{ name: 'master.wav', mimeType: 'audio/wav', buffer: Buffer.from(bytes) }]);
	const dialog = await openExportDialog(page, editor);
	const normalization = dialog.locator('[data-export-field="loudnessNormalization"]');
	if (priorTarget) {
		await chooseDropdown(page, normalization, 'EBU R 128 (-23 LUFS)');
		await expect(normalization).toContainText('EBU R 128 (-23 LUFS)');
	}
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'BW64 / ADM');
	await expect(normalization.getByRole('button')).toBeDisabled();
	await expect(normalization).toContainText('None');
	await dialog.getByRole('button', { name: 'Metadata', exact: true }).click();
	const metadata = page.getByRole('dialog', { name: 'Metadata', exact: true });
	await metadata.getByRole('tab', { name: 'General', exact: true }).click();
	await metadata.locator('[data-export-metadata-tab="general"]').getByRole('textbox', { name: 'Title', exact: true }).fill('');
	await metadata.getByRole('button', { name: /^Done\.?$/u }).click();
	const downloading = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = await downloading;
	const stream = await download.createReadStream();
	const parts = [];
	for await (const part of stream) parts.push(part);
	const delivered = Buffer.concat(parts);
	const descriptor = await inspectWavBlobPcm(new Blob([delivered]));
	expect(descriptor.adm?.valid).toBe(true);
	expect(descriptor.frameCount).toBe(4800);
	expect(descriptor.channelCount).toBe(2);
	expect(descriptor.sampleRate).toBe(48_000);
	const deliveredPcm = delivered.subarray(descriptor.dataOffset, descriptor.dataOffset + descriptor.dataByteLength);
	const originalPcm = Buffer.from(bytes).subarray(original.dataOffset, original.dataOffset + original.dataByteLength);
	expect(deliveredPcm.byteLength).toBe(originalPcm.byteLength);
	expect(deliveredPcm.equals(originalPcm)).toBe(true);
	expect(errors).toEqual([]);
});

function chunk(id, payload) {
	const bytes = Buffer.alloc(8 + payload.length + payload.length % 2);
	bytes.write(id); bytes.writeUInt32LE(payload.length, 4); bytes.set(payload, 8);
	return bytes;
}
