/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { nativeQuickTimeAvFixture } from '../helpers/native-quicktime-av-fixture.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

for (const variant of ['generic', 'proper', 'audio']) test(`ordinary ${variant} QuickTime MOV retains picture classification and native Save`, async ({ page }) => {
	test.setTimeout(45_000);
	const file = nativeQuickTimeAvFixture(variant === 'audio' ? 'audio' : 'av', variant === 'proper' ? 'video/quicktime' : 'application/octet-stream');
	const original = Buffer.from(await file.arrayBuffer());
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: original });
	await expect(editor).toHaveAttribute('data-clip-count', variant === 'audio' ? '1' : '2', { timeout: 15_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await expect(editor.locator('[data-clip-kind="video"]')).toHaveCount(variant === 'audio' ? 0 : 1);
	if (variant !== 'audio') {
		const image = editor.locator('.audio-editor-video-clip__filmstrip img').first();
		await expect.poll(() => image.evaluate(value => value.complete && value.naturalWidth === 64 && value.naturalHeight === 32)).toBe(true);
		const rgba = await image.evaluate(value => {
			const canvas = document.createElement('canvas'); canvas.width = value.naturalWidth; canvas.height = value.naturalHeight;
			const context = canvas.getContext('2d'); context.drawImage(value, 0, 0);
			return [...context.getImageData(32, 16, 1, 1).data];
		});
		// Authored RGB20/80/220 remains blue after H264 and the existing WebP filmstrip encoding.
		expect(rgba[0]).toBeLessThan(40); expect(rgba[1]).toBeGreaterThan(60); expect(rgba[1]).toBeLessThan(100);
		expect(rgba[2]).toBeGreaterThan(200); expect(rgba[3]).toBe(255);
	}
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
	const videos = project.sources.filter(source => source.kind === 'video'); expect(videos).toHaveLength(variant === 'audio' ? 0 : 1);
	if (variant !== 'audio') {
		const video = videos[0];
		expect(video).toMatchObject({ width: 64, height: 32, sourceFrameCount: 9, frameRate: { num: 30, den: 1 }, videoCodec: 'h264', hasAudio: true });
		expect(Buffer.from(entries[`media/${video.id}/original`])).toEqual(original);
	}
	const audios = project.sources.filter(source => source.kind === 'audio'); expect(audios).toHaveLength(1);
	const audio = audios[0]; expect(audio.channelCount).toBe(2); expect(audio.frameCount).toBeGreaterThan(0);
	const pcm = Buffer.from(entries[`audio/${audio.id}.f32c`]); let peak = 0;
	for (let offset = 4; offset < pcm.byteLength; offset += 4) { const value = pcm.readFloatLE(offset); expect(Number.isFinite(value)).toBe(true); peak = Math.max(peak, Math.abs(value)); }
	expect(peak).toBeGreaterThan(.1);
	await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toHaveCount(0);
});
