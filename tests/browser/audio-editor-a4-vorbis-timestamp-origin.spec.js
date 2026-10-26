/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { vorbisTimestampFixture, vorbisTimestampReference } from '../helpers/vorbis-timestamp-fixture.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseDropdown, chooseExportProjectFileAction, disableNativeSavePicker,
	downloadBytes, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

for (const absolute of [false, true]) test(`File Import owns the Vorbis recording extent rather than its absolute broadcast clock=${String(absolute)}`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const file = vorbisTimestampFixture(absolute), reference = vorbisTimestampReference();
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 10_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources[0]).toMatchObject({ sampleRate: 48_000, channelCount: 2, frameCount: 4800 });
	const source = Buffer.from(Object.entries(entries).find(([name]) => name.endsWith('.f32c'))[1]);
	for (let channel = 0; channel < 2; channel++) {
		let error = 0;
		for (let frame = 0; frame < 4800; frame++) error = Math.max(error, Math.abs(source.readFloatLE(4 + (channel * 4800 + frame) * 4) - reference[channel][frame]));
		expect(error).toBeLessThan(1e-6);
	}
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '32-bit Float');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 20_000 });
	const wave = await readDownloadBytes(page, link), descriptor = await inspectWavBlobPcm(new Blob([wave]));
	expect(descriptor).toMatchObject({ sampleRate: 48_000, channelCount: 2, frameCount: 4800 });
	const rendered = await page.evaluate(async bytes => {
		const decoded = await new OfflineAudioContext(2, 1, 48_000).decodeAudioData(Uint8Array.from(bytes).buffer);
		return Array.from({ length: 2 }, (_, channel) => [...decoded.getChannelData(channel)]);
	}, [...wave]);
	for (let channel = 0; channel < 2; channel++) {
		let error = 0;
		for (let frame = 1000; frame < 4000; frame++) error = Math.max(error, Math.abs(rendered[channel][frame] - reference[channel][frame]));
		expect(error).toBeLessThan(1e-6);
	}
});
