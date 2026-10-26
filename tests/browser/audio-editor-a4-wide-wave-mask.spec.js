/* SPDX-License-Identifier: AGPL-3.0-only */
import { AudioSampleSink, BlobSource, Input, WAVE } from 'mediabunny';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, disableNativeSavePicker, openExportDialog, readDownloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';

for (const channelCount of [18, 19, 32]) test(`ordinary ${channelCount}-channel 20-bit WAV export does not assign reserved speakers`, async ({ page }) => {
	test.setTimeout(60_000); await disableNativeSavePicker(page);
	await page.addInitScript(() => { Object.defineProperty(globalThis, 'launchQueue', { configurable: true, value: {
		setConsumer(consumer) { globalThis.__wideWaveOpen = consumer; },
	} }); });
	const editor = await bootEditor(page, '/embed/en/');
	const project = createSoundscaperProject({ id: `wide-wave-mask-${channelCount}`, sampleRate: 48000, masterChannels: channelCount });
	const archive = await createSoundscaperScapeNativeRuntime().exportScapeProject(project, {
		async getMediaAssetMetadata() { return null; }, async loadMediaAsset() { return null; }, readSourceChunks() { return (async function* () {})(); },
	});
	await page.evaluate(async bytes => {
		const file = new File([Uint8Array.from(bytes)], 'Programme.sscape', { type: 'application/x-scape-project' });
		await globalThis.__wideWaveOpen({ files: [{ kind: 'file', getFile: () => Promise.resolve(file) }] });
	}, [...new Uint8Array(await archive.blob.arrayBuffer())]);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const channels = Array.from({ length: channelCount }, (_, channel) => new Float32Array(2400).fill((channel + 1) / 64));
	const original = encodeWav(channels, { sampleRate: 48000, bitDepth: 32, float: true });
	await editor.locator('[data-import-input]').setInputFiles({ name: 'Discrete tracks.wav', mimeType: 'audio/wav', buffer: Buffer.from(original) });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '20-bit PCM');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 20_000 });
	const bytes = await readDownloadBytes(page, link), geometry = await inspectWavBlobPcm(new Blob([bytes]));
	expect(geometry).toMatchObject({ channelCount, frameCount: 2400, sampleRate: 48000, validBitsPerSample: 20 });
	expect(geometry.channelMask).toBe(channelCount > 18 ? 0 : 0x3ffff);
	const input = new Input({ source: new BlobSource(new Blob([bytes])), formats: [WAVE] });
	try {
		const track = await input.getPrimaryAudioTrack(); expect(await track.getNumberOfChannels()).toBe(channelCount);
		let checked = false, position = 0;
		for await (const sample of new AudioSampleSink(track).samples()) {
			try {
				if (position <= 1200 && position + sample.numberOfFrames > 1200) {
					for (let channel = 0; channel < channelCount; channel++) {
						const pcm = new Float32Array(sample.numberOfFrames); sample.copyTo(pcm, { planeIndex: channel, format: 'f32-planar' });
						expect(Math.abs(pcm[1200 - position] - (channel + 1) / 64)).toBeLessThan(4 / 524288);
					}
					checked = true;
				}
				position += sample.numberOfFrames;
			} finally { sample.close(); }
		}
		expect(checked).toBe(true); expect(position).toBe(2400);
	} finally { input.dispose(); }
});
