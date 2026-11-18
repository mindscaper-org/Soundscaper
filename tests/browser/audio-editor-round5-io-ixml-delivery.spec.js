/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import {
	bootEditor, chooseDropdown, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

// Unchanged BWF MetaEdit --in-iXML output over an ordinary Python wave recording.
const recording = Buffer.from(readFileSync(new URL('../fixtures/bwfmetaedit-ixml-clock.wav.base64', import.meta.url), 'utf8').trim(), 'base64');

// Node covers both output clocks through import, Scape reopening and encoded XML.
// The unchanged browser delivery remains in round6-io-bwf-import-metadata.
const delivery = { rate: 96_000, bits: 24, slate: 48_000 };
test('a resampled broadcast delivery keeps the recorder slate at its audible half-second position', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [{ name: 'production-take.wav', mimeType: 'audio/wav', buffer: recording }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'Broadcast WAV (BWF)');
	await dialog.locator('[data-export-field="sampleRate"] input').fill(String(delivery.rate));
	await dialog.locator('[data-export-field="sampleRate"] input').press('Tab');
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), `${delivery.bits}-bit PCM`);
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const bytes = await readDownloadBytes(page, link);
	const chunks = riffChunks(bytes);
	const format = new DataView(chunks.get('fmt ').buffer, chunks.get('fmt ').byteOffset, chunks.get('fmt ').byteLength);
	expect(format.getUint32(4, true)).toBe(delivery.rate);
	const xml = new TextDecoder().decode(chunks.get('iXML'));
	await test.info().attach('delivered-recorder-iXML', { body: xml, contentType: 'application/xml' });
	expect(xml).toContain('<NOTE>Clean boom take</NOTE>');
	expect(xml).toContain(`<SYNC_POINT_LOW>${delivery.slate}</SYNC_POINT_LOW>`);
	expect(xml).toContain(`<FILE_SAMPLE_RATE>${delivery.rate}</FILE_SAMPLE_RATE>`);
	expect(xml).toContain(`<AUDIO_BIT_DEPTH>${delivery.bits}</AUDIO_BIT_DEPTH>`);
	expect(xml).toContain('<DIGITIZER_SAMPLE_RATE>48000</DIGITIZER_SAMPLE_RATE>');
});

test('a resampled broadcast WAV writes the same start time in BEXT and iXML', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const originalReference = '2246400000';
	const rawXml = '<BWFXML><SPEED><FILE_SAMPLE_RATE>48000</FILE_SAMPLE_RATE>'
		+ '<TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_HI>0</TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_HI>'
		+ `<TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_LO>${originalReference}</TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_LO>`
		+ '<TIMESTAMP_SAMPLE_RATE>48000</TIMESTAMP_SAMPLE_RATE></SPEED></BWFXML>';
	const bytes = encodeWav([new Float32Array(4_800)], { sampleRate: 48_000,
		bext: { timeReference: originalReference }, ixml: { rawXml } });
	await importFiles(editor, [{ name: 'afternoon-take.wav', mimeType: 'audio/wav', buffer: Buffer.from(bytes) }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'Broadcast WAV (BWF)');
	await dialog.locator('[data-export-field="sampleRate"] input').fill('96000');
	await dialog.locator('[data-export-field="sampleRate"] input').press('Tab');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const chunks = riffChunks(await readDownloadBytes(page, link));
	const bext = chunks.get('bext');
	const view = new DataView(bext.buffer, bext.byteOffset, bext.byteLength);
	expect(view.getBigUint64(338, true)).toBe(4_492_800_000n);
	const xml = new TextDecoder().decode(chunks.get('iXML'));
	expect(xml).toContain(`<TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_HI>${view.getUint32(342, true)}</TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_HI>`);
	expect(xml).toContain(`<TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_LO>${view.getUint32(338, true)}</TIMESTAMP_SAMPLES_SINCE_MIDNIGHT_LO>`);
	expect(xml).toContain('<TIMESTAMP_SAMPLE_RATE>96000</TIMESTAMP_SAMPLE_RATE>');
});

function riffChunks(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const chunks = new Map();
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const size = view.getUint32(offset + 4, true);
		chunks.set(new TextDecoder().decode(bytes.subarray(offset, offset + 4)), bytes.subarray(offset + 8, offset + 8 + size));
		offset += 8 + size + (size % 2);
	}
	return chunks;
}
