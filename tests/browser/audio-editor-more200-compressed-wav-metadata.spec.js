/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, chooseFileAction, disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { nativeOriginalImportFixture } from '../helpers/native-original-import-fixture.ts';
import { installNativeOriginalBridge } from './helpers/native-original-import-bridge.js';

for (const codec of ['ima', 'mp3', 'pcm']) test(`${codec} WAV File Import and Save retain its independent credits`, async ({ page }) => {
	const buffer = Buffer.from(readFileSync(new URL(`../fixtures/ffmpeg-${codec}-info.wav.base64`, import.meta.url), 'utf8').trim(), 'base64');
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const decoded = await page.evaluate(async data => {
		const context = new OfflineAudioContext(1, 1, 48_000);
		try {
			const audio = await context.decodeAudioData(Uint8Array.from(data).buffer);
			return { supported: true, frames: audio.length, sampleRate: audio.sampleRate, channelCount: audio.numberOfChannels,
				channels: Array.from({ length: audio.numberOfChannels }, (_, channel) => [...audio.getChannelData(channel)]) };
		} catch { return { supported: false }; }
		finally { if (context instanceof AudioContext) await context.close(); }
	}, [...buffer]);
	if (!decoded.supported) {
		await editor.locator('[data-import-input]').setInputFiles({ name: `${codec}.wav`, mimeType: 'audio/wav', buffer });
		await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toContainText('0 file(s) imported, 1 failed', { timeout: 30_000 });
		await expect(editor).toHaveAttribute('data-clip-count', '0'); return;
	}
	await importFiles(editor, [{ name: `${codec}.wav`, mimeType: 'audio/wav', buffer }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 20_000 });
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const panel = editor.locator('[data-workspace-panel="metadata"]');
	await panel.getByRole('tab', { name: 'Attribution', exact: true }).click();
	const attribution = panel.getByRole('tabpanel', { name: 'Attribution', exact: true });
	await attribution.getByText('Imported metadata', { exact: true }).click();
	const title = attribution.locator('dl > div').filter({ has: page.getByText('normalized.title', { exact: true }) });
	await expect(title.locator('dd')).toHaveText('Harbour voices');
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading)); const project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources).toHaveLength(1);
	const source = project.sources[0];
	const metadata = source.provenance.contributions[0].metadata;
	expect(metadata.normalized).toMatchObject({ title: 'Harbour voices', artist: 'Elodie field recording' });
	expect(source).toMatchObject({ sampleRate: decoded.sampleRate, frameCount: decoded.frames, channelCount: decoded.channelCount });
	const [, payload] = Object.entries(entries).find(([name]) => name.endsWith('.f32c')); const pcm = Buffer.from(payload);
	let dataOffset = 12;
	if (codec === 'pcm') while (buffer.toString('ascii', dataOffset, dataOffset + 4) !== 'data') {
		const size = buffer.readUInt32LE(dataOffset + 4); dataOffset += 8 + size + size % 2;
	}
	// The PCM import retains signed integer normalization; browser decoders can
	// instead divide positive samples by 32767. Compare those bytes directly.
	for (let channel = 0; channel < decoded.channelCount; channel++) {
		const expected = codec === 'pcm' ? Array.from({ length: decoded.frames }, (_, frame) => buffer.readInt16LE(dataOffset + 8 + frame * 2) / 32768) : decoded.channels[channel];
		expect(Array.from({ length: decoded.frames }, (_, frame) => pcm.readFloatLE(4 + (channel * decoded.frames + frame) * 4))).toEqual(expected);
	}
});

for (const codec of ['pcm', 'mp3']) test(`desktop File Import retains selected-range ${codec} credits`, async ({ page }) => {
	const bytes = Buffer.from(readFileSync(new URL(`../fixtures/ffmpeg-${codec}-info.wav.base64`, import.meta.url), 'utf8').trim(), 'base64');
	const native = await nativeOriginalImportFixture(new File([bytes], `${codec}.wav`, { type: 'audio/wav' }));
	try {
		await installNativeOriginalBridge(page, native); const editor = await bootEditor(page, '/embed/en/');
		await chooseFileAction(page, editor, 'Import');
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		const panel = editor.locator('[data-workspace-panel="metadata"]');
		await panel.getByRole('tab', { name: 'Attribution', exact: true }).click();
		const attribution = panel.getByRole('tabpanel', { name: 'Attribution', exact: true });
		await attribution.getByText('Imported metadata', { exact: true }).click();
		const title = attribution.locator('dl > div').filter({ has: page.getByText('normalized.title', { exact: true }) });
		await expect(title.locator('dd')).toHaveText('Harbour voices');
	} finally { await native.close(); }
});
