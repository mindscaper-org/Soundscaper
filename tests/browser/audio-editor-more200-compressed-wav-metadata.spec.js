/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseExportProjectFileAction, chooseFileAction,
	disableNativeSavePicker, downloadBytes, waitForEditor, waitForProjectActivation,
} from './audio-editor-test-helpers.js';
import { nativeOriginalImportFixture } from '../helpers/native-original-import-fixture.ts';
import { installNativeOriginalBridge } from './helpers/native-original-import-bridge.js';

const recording = codec => Buffer.from(readFileSync(new URL(`../fixtures/ffmpeg-${codec}-info.wav.base64`, import.meta.url), 'utf8').trim(), 'base64');

// Node tests retain each metadata and transport variant through controller import
// and Scape reopen. This batch retains every real native decoder and saved sample.
test('WAV File Import and Save retain independent credits and native PCM across codecs', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	let editor = await bootEditor(page, '/embed/en/');
	const supported = [];
	for (const codec of ['ima', 'mp3', 'pcm']) {
		const buffer = recording(codec);
		const decoded = await page.evaluate(async data => {
			const context = new OfflineAudioContext(1, 1, 48_000);
			try {
				const audio = await context.decodeAudioData(Uint8Array.from(data).buffer);
				return { supported: true, frames: audio.length, sampleRate: audio.sampleRate, channelCount: audio.numberOfChannels,
					channels: Array.from({ length: audio.numberOfChannels }, (_, channel) => [...audio.getChannelData(channel)]) };
			} catch { return { supported: false }; }
			finally { if (context instanceof AudioContext) await context.close(); }
		}, [...buffer]);
		const file = { name: `${codec}.wav`, mimeType: 'audio/wav', buffer };
		if (decoded.supported) supported.push({ codec, file, decoded });
		else {
			await editor.locator('[data-import-input]').setInputFiles(file);
			await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toContainText('0 file(s) imported, 1 failed', { timeout: 30_000 });
			await expect(editor).toHaveAttribute('data-clip-count', '0');
		}
	}
	expect(supported.length).toBeGreaterThan(0);
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles(supported.map(({ file }) => file));
	await expect(editor).toHaveAttribute('data-clip-count', String(supported.length), { timeout: 30_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing', { timeout: 30_000 });
	await waitForProjectActivation(editor);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const panel = editor.locator('[data-workspace-panel="metadata"]');
	await panel.getByRole('tab', { name: 'Attribution', exact: true }).click();
	const attribution = panel.getByRole('tabpanel', { name: 'Attribution', exact: true });
	const details = attribution.getByText('Imported metadata', { exact: true });
	await expect(details).toHaveCount(supported.length);
	for (const summary of await details.all()) await summary.click();
	const titles = attribution.locator('dl > div').filter({ has: page.getByText('normalized.title', { exact: true }) });
	await expect(titles.locator('dd')).toHaveText(supported.map(() => 'Harbour voices'));
	for (const reload of [false, true]) {
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		if (reload) {
			await page.reload(); editor = await waitForEditor(page); await waitForProjectActivation(editor);
			await expect(editor).toHaveAttribute('data-clip-count', String(supported.length));
		}
		const downloading = page.waitForEvent('download');
		await chooseExportProjectFileAction(page, editor);
		const download = await downloading;
		let bytes;
		try { bytes = await downloadBytes(download); } finally { await download.delete(); }
		const entries = unzipSync(bytes), project = JSON.parse(strFromU8(entries['project.json']));
		expect(project.sources).toHaveLength(supported.length);
		for (const { codec, file, decoded } of supported) {
			const source = project.sources.find(source => source.name === file.name);
			expect(source, file.name).toBeDefined();
			expect(source.provenance.contributions[0].metadata.normalized).toMatchObject({ title: 'Harbour voices', artist: 'Elodie field recording' });
			expect(source).toMatchObject({ sampleRate: decoded.sampleRate, frameCount: decoded.frames, channelCount: decoded.channelCount });
			const pcm = Buffer.from(entries[`audio/${source.id}.f32c`]);
			expect(pcm.readUInt32LE(0)).toBe(decoded.frames);
			let dataOffset = 12;
			if (codec === 'pcm') while (file.buffer.toString('ascii', dataOffset, dataOffset + 4) !== 'data') {
				const size = file.buffer.readUInt32LE(dataOffset + 4); dataOffset += 8 + size + size % 2;
			}
			// Integer PCM retains /32768 normalization independently of native decoding.
			for (let channel = 0; channel < decoded.channelCount; channel++) {
				const expected = codec === 'pcm' ? Array.from({ length: decoded.frames }, (_, frame) => file.buffer.readInt16LE(dataOffset + 8 + frame * 2) / 32768) : decoded.channels[channel];
				expect(Array.from({ length: decoded.frames }, (_, frame) => pcm.readFloatLE(4 + (channel * decoded.frames + frame) * 4))).toEqual(expected);
			}
		}
	}
});

test('desktop File Import retains selected-range mp3 credits', async ({ page }) => {
	const native = await nativeOriginalImportFixture(new File([recording('mp3')], 'mp3.wav', { type: 'audio/wav' }));
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
