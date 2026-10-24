/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { nativeMpegLayerOneFixture } from '../helpers/native-mpeg-layer-one-fixture.ts';
import { nativeQuickTimePcmFixture } from '../helpers/quicktime-pcm-audio-fixture.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

for (const format of ['mov', 'mp1']) for (const opening of [false, true]) test(`File ${opening ? 'Open' : 'Import'} retains existing native ${format} with generic platform MIME`, async ({ page }) => {
	test.setTimeout(45_000);
	const file = format === 'mov' ? nativeQuickTimePcmFixture('sowt') : nativeMpegLayerOneFixture().file;
	const sampleRate = format === 'mov' ? 48_000 : 32_000, frames = format === 'mov' ? 4800 : 18_816;
	const bytes = new Uint8Array(await file.arrayBuffer());
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const expected = await page.evaluate(async ({ bytes, sampleRate }) => {
		try {
			const decoded = await new OfflineAudioContext(2, 1, sampleRate).decodeAudioData(Uint8Array.from(bytes).buffer);
			return [0, 1].map(channel => [...decoded.getChannelData(channel)]);
		} catch { return null; }
	}, { bytes: [...bytes], sampleRate });
	await editor.locator(opening ? '[data-aup4-input]' : '[data-import-input]').setInputFiles({
		name: `Recording.${format}`, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes),
	});
	if (expected === null) {
		await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toContainText('0 file(s) imported, 1 failed', { timeout: 15_000 });
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		await editor.locator('[data-import-input]').setInputFiles({ name: 'Fresh.wav', mimeType: 'audio/wav',
			buffer: Buffer.from(encodeWav([new Float32Array(2400).fill(.125)], { sampleRate: 48_000, bitDepth: 32, float: true })) });
		await expect(editor).toHaveAttribute('data-clip-count', '1'); return;
	}
	expect(expected.every(channel => channel.length === frames)).toBe(true);
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 15_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources[0]).toMatchObject({ sampleRate, frameCount: frames, channelCount: 2 });
	const pcm = Buffer.from(entries[`audio/${project.sources[0].id}.f32c`]); let error = 0;
	for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < frames; frame++) {
		error = Math.max(error, Math.abs(pcm.readFloatLE(4 + (channel * frames + frame) * 4) - expected[channel][frame]));
	}
	expect(error).toBeLessThan(1e-7);
});
