/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { aacLcM4a44_100Fixture } from '../helpers/os-audio-codec-fixtures.ts';
import { opaqueIsoHeAacFixture } from '../helpers/opaque-iso-aac-fixture.ts';
import { implicitAacFixture } from '../helpers/implicit-sbr-aac-fixture.ts';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes,
	openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

async function importAndSave(page, bytes, name, mimeType) {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-import-input]').setInputFiles({ name, mimeType, buffer: Buffer.from(bytes) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 10_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources[0]).toMatchObject({ sampleRate: 44_100, frameCount: 2205, channelCount: 2 });
	return { editor, pcm: Buffer.from(entries[`audio/${project.sources[0].id}.f32c`]) };
}
async function exportFloatWave(page, editor, sampleRate = 44_100) {
	const dialog = await openExportDialog(page, editor);
	await dialog.locator('[data-export-field="sampleRate"] input').fill(String(sampleRate));
	await dialog.locator('[data-export-field="sampleRate"] input').press('Tab');
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '32-bit Float');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 20_000 });
	return readDownloadBytes(page, link);
}
for (const [name, mimeType] of [['Recording.bin', 'application/octet-stream'], ['download', '']]) {
	test(`opaque AAC ${name} retains named-file PCM, source clock and WAV delivery`, async ({ page, browser }) => {
		test.setTimeout(60_000);
		const bytes = aacLcM4a44_100Fixture(), referencePage = await browser.newPage();
		try {
			// The independent named import remains the decoder/profile authority. This
			// repair routes identical bytes to it, without pinning AAC's core clock.
			const reference = await importAndSave(referencePage, bytes, 'Recording.m4a', 'audio/mp4');
			const actual = await importAndSave(page, bytes, name, mimeType);
			expect(actual.pcm.equals(reference.pcm)).toBe(true);
			let peak = 0; for (let offset = 4; offset < actual.pcm.length; offset += 4) peak = Math.max(peak, Math.abs(actual.pcm.readFloatLE(offset)));
			expect(peak).toBeGreaterThan(.05);
			const expectedWave = await exportFloatWave(referencePage, reference.editor), wave = await exportFloatWave(page, actual.editor);
			expect(await inspectWavBlobPcm(new Blob([wave]))).toMatchObject({ sampleRate: 44_100, frameCount: 2205, channelCount: 2 });
			const decoded = await page.evaluate(async files => Promise.all(files.map(async bytes => {
				const buffer = await new OfflineAudioContext(2, 1, 44_100).decodeAudioData(Uint8Array.from(bytes).buffer);
				return [0, 1].map(channel => [...buffer.getChannelData(channel)]);
			})), [[...wave], [...expectedWave]]);
			let error = 0; for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < 2205; frame++) {
				error = Math.max(error, Math.abs(decoded[0][channel][frame] - decoded[1][channel][frame]));
			}
			expect(error).toBeLessThan(1e-7);
		} finally { await referencePage.close(); }
	});
}


test('opaque in-band HE-AAC retains its native compatibility path while named profile refusal remains unchanged', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const bytes = opaqueIsoHeAacFixture();
	await editor.locator('[data-import-input]').setInputFiles({ name: 'Profile.m4a', mimeType: 'audio/mp4', buffer: Buffer.from(bytes) });
	await expect(editor.getByRole('alert')).toContainText('The decoded compressed audio sample geometry changed or is unsupported.');
	await expect(editor).toHaveAttribute('data-clip-count', '0'); await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await editor.locator('[data-import-input]').setInputFiles({ name: 'Profile.bin', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 10_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources).toHaveLength(1); expect(project.clips).toHaveLength(1);
	expect(project.sources[0]).toMatchObject({ sampleRate: 48_000, frameCount: 10_240, channelCount: 2 });
	const pcm = Buffer.from(entries[`audio/${project.sources[0].id}.f32c`]), { channels } = implicitAacFixture('he');
	let error = 0;
	for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < 10_240; frame++) {
		error = Math.max(error, Math.abs(pcm.readFloatLE(4 + (channel * 10_240 + frame) * 4) - channels[channel][frame]));
	}
	expect(error).toBeLessThan(1e-6);
	const wave = await exportFloatWave(page, editor, 48_000);
	expect(await inspectWavBlobPcm(new Blob([wave]))).toMatchObject({ sampleRate: 48_000, frameCount: 10_240, channelCount: 2 });
	const rendered = await page.evaluate(async bytes => {
		const buffer = await new OfflineAudioContext(2, 1, 48_000).decodeAudioData(Uint8Array.from(bytes).buffer);
		return [0, 1].map(channel => [...buffer.getChannelData(channel)]);
	}, [...wave]);
	error = 0;
	for (let channel = 0; channel < 2; channel++) for (let frame = 1000; frame < 9240; frame++) {
		error = Math.max(error, Math.abs(rendered[channel][frame] - channels[channel][frame]));
	}
	expect(error).toBeLessThan(1e-6);
});
