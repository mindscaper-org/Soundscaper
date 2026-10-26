/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { implicitAacFixture } from '../helpers/implicit-sbr-aac-fixture.ts';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes,
	openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

for (const profile of ['he', 'ps', 'lc']) test(`File Import preserves native reconstructed ${profile} AAC clock, stereo and PCM`, async ({ page }) => {
	test.setTimeout(60_000);
	const { file, frameCount } = implicitAacFixture(profile);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 15_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources[0]).toMatchObject({ sampleRate: 48_000, frameCount, channelCount: 2 });
	const pcm = Buffer.from(entries[`audio/${project.sources[0].id}.f32c`]); let peak = 0, stereoDifference = 0;
	for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < frameCount; frame++) {
		peak = Math.max(peak, Math.abs(pcm.readFloatLE(4 + (channel * frameCount + frame) * 4)));
	}
	for (let frame = 0; frame < frameCount; frame++) {
		stereoDifference = Math.max(stereoDifference, Math.abs(
			pcm.readFloatLE(4 + frame * 4) - pcm.readFloatLE(4 + (frameCount + frame) * 4),
		));
	}
	expect(peak).toBeGreaterThan(.1); expect(stereoDifference).toBeGreaterThan(.01);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '32-bit Float');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 20_000 });
	const wave = await readDownloadBytes(page, link);
	expect(await inspectWavBlobPcm(new Blob([wave]))).toMatchObject({ sampleRate: 48_000, frameCount, channelCount: 2 });
	const rendered = await page.evaluate(async bytes => {
		const decoded = await new OfflineAudioContext(2, 1, 48_000).decodeAudioData(Uint8Array.from(bytes).buffer);
		return [0, 1].map(channel => [...decoded.getChannelData(channel)]);
	}, [...wave]);
	let maximumError = 0;
	for (let channel = 0; channel < 2; channel++) for (let frame = 1000; frame < frameCount - 1000; frame++) {
		maximumError = Math.max(maximumError, Math.abs(
			rendered[channel][frame] - pcm.readFloatLE(4 + (channel * frameCount + frame) * 4),
		));
	}
	expect(maximumError).toBeLessThan(1e-6);
});
