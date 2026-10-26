/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { foreignScafAacFixture } from '../helpers/foreign-scaf-aac-fixture.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

for (const variant of ['foreign', 'unrelated', 'plain']) test(`ordinary AAC ${variant} custom metadata retains File Import and native Save PCM`, async ({ page }) => {
	test.setTimeout(60_000);
	const { file } = foreignScafAacFixture(variant);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const native = await page.evaluate(async bytes => {
		const decoded = await new OfflineAudioContext(2, 1, 32_000).decodeAudioData(Uint8Array.from(bytes).buffer);
		return [0, 1].map(channel => [...decoded.getChannelData(channel)]);
	}, [...new Uint8Array(await file.arrayBuffer())]);
	expect(native).toHaveLength(2); expect(native[0]).toHaveLength(4800); expect(native[1]).toHaveLength(4800);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 15_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
	const source = project.sources[0]; expect(source).toMatchObject({ sampleRate: 32_000, frameCount: 4800, channelCount: 2 });
	const pcm = Buffer.from(entries[`audio/${source.id}.f32c`]); let maximumError = 0, peak = 0;
	for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < 4800; frame++) {
		const value = pcm.readFloatLE(4 + (channel * 4800 + frame) * 4);
		maximumError = Math.max(maximumError, Math.abs(value - native[channel][frame])); peak = Math.max(peak, Math.abs(value));
	}
	expect(maximumError).toBeLessThan(.0000001); expect(peak).toBeGreaterThan(.1);
	await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toHaveCount(0);
});
