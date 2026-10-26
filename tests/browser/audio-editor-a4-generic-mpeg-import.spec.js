/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { mpegTwoMp3_16_000Fixture } from '../helpers/os-audio-codec-fixtures.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

for (const generic of [false, true]) test(`File Import retains MPEG gapless PCM for a generic identity=${generic}`, async ({ page, browserName }) => {
	const { file: original, pcm: reference } = mpegTwoMp3_16_000Fixture();
	// Firefox's native MPEG synthesis differs slightly from FFmpeg float output.
	// Its independent full-file decode still provides exact gapless PCM authority.
	const expected = browserName === 'firefox' ? await page.evaluate(async bytes => {
		const decoded = await new OfflineAudioContext(1, 1, 16_000).decodeAudioData(Uint8Array.from(bytes).buffer);
		return [...decoded.getChannelData(0)];
	}, [...new Uint8Array(await original.arrayBuffer())]) : reference;
	expect(expected).toHaveLength(1600);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-import-input]').setInputFiles({ name: generic ? 'Recording.bin' : original.name,
		mimeType: generic ? 'application/octet-stream' : original.type, buffer: Buffer.from(await original.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1'); await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const pending = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await pending)), project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources[0]).toMatchObject({ sampleRate: 16_000, frameCount: 1600, channelCount: 1 });
	const pcm = Buffer.from(Object.entries(entries).find(([key]) => key.endsWith('.f32c'))[1]);
	let maximumError = 0;
	for (let frame = 0; frame < expected.length; frame++) maximumError = Math.max(maximumError, Math.abs(pcm.readFloatLE(4 + frame * 4) - expected[frame]));
	expect(maximumError).toBeLessThan(1e-6);
});
