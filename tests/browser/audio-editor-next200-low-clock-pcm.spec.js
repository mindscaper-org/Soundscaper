/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { lowClockPcmFixture } from '../helpers/low-clock-pcm-fixture.ts';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseExportProjectFileAction, chooseNestedCommandAction, clipByName, disableNativeSavePicker, downloadBytes, openSourceMonitor, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

for (const rate of [1000, 48000]) test(`ordinary ${rate} Hz PCM File Import delivers its full audible extent`, async ({ page }) => {
	test.setTimeout(45_000);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-import-input]').setInputFiles({ name: `Original ${rate}.wav`, mimeType: 'audio/wav', buffer: Buffer.from(await lowClockPcmFixture(rate).file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '32-bit Float');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 15_000 });
	const wave = await readDownloadBytes(page, link), descriptor = await inspectWavBlobPcm(new Blob([wave]));
	expect(descriptor.sampleRate).toBe(48_000); expect(descriptor.frameCount).toBe(48_000);
	const view = new DataView(wave.buffer, wave.byteOffset, wave.byteLength); let energy = 0;
	for (let frame = 1000; frame < 47000; frame++) energy += view.getFloat32(descriptor.dataOffset + frame * descriptor.blockAlign, true) ** 2;
	expect(Math.sqrt(energy / 46000)).toBeGreaterThan(.05);
});

for (const rate of [1000, 48000]) test(`ordinary ${rate} Hz PCM Source monitor supports Invert`, async ({ page }) => {
	test.setTimeout(45_000);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const name = `Source ${rate}.wav`;
	await editor.locator('[data-import-input]').setInputFiles({ name, mimeType: 'audio/wav', buffer: Buffer.from(await lowClockPcmFixture(rate).file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const panel = await openSourceMonitor(page, editor, clipByName(editor, name));
	const waveform = panel.getByRole('region', { name: 'Source waveform', exact: true });
	await waveform.focus(); await waveform.press('Control+a');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Invert']);
	await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.', { timeout: 15_000 });
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
	const source = project.sources.find(item => item.id === project.clips[0].sourceId);
	expect(source).toMatchObject({ sampleRate: rate, frameCount: rate, channelCount: 1 });
	const pcm = Buffer.from(entries[`audio/${source.id}.f32c`]), expected = lowClockPcmFixture(rate).channel;
	expect(pcm.length).toBe(4 + rate * 4);
	let error = 0;
	for (let frame = 0; frame < rate; frame++) error = Math.max(error, Math.abs(pcm.readFloatLE(4 + frame * 4) + expected[frame]));
	expect(error).toBe(0);
});
