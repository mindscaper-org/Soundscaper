/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { writeFile } from 'node:fs/promises';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { surroundAvWebmFixture } from '../helpers/ordinary-ogg-opus-fixture.ts';

test('File Import and native Save retain all six channels extracted from an ordinary video', async ({ page }, testInfo) => {
	// Decode, import publication and native Save each need their own bounded wait.
	test.setTimeout(90_000);
	const file = await surroundAvWebmFixture(); const bytes = new Uint8Array(await file.arrayBuffer());
	await page.addInitScript(fileSize => {
		// Observe the import's own native decode. A second context can have a
		// different WebKit decoder lifetime and changes the backend being tested.
		const decode = BaseAudioContext.prototype.decodeAudioData;
		BaseAudioContext.prototype.decodeAudioData = function (encoded, ...args) {
			if (encoded.byteLength !== fileSize) return decode.call(this, encoded, ...args);
			globalThis.__surroundNativeDecode = { state: 'pending' };
			const result = decode.call(this, encoded, ...args);
			void result.then(audio => {
				globalThis.__surroundNativeDecode = { state: 'decoded', sampleRate: audio.sampleRate, frames: audio.length,
					channels: Array.from({ length: audio.numberOfChannels }, (_, channel) => [...audio.getChannelData(channel)]) };
			}, error => { globalThis.__surroundNativeDecode = { state: 'rejected', error: `${error.name}: ${error.message}` }; });
			return result;
		};
	}, bytes.byteLength);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	// Keep native media reads backed by a real file after the editor clears the input.
	const filePath = testInfo.outputPath(file.name);
	await writeFile(filePath, bytes);
	await editor.locator('[data-import-input]').setInputFiles(filePath);
	await expect(editor).toHaveAttribute('data-clip-count', /^[12]$/u, { timeout: 45_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const expected = await page.evaluate(() => globalThis.__surroundNativeDecode);
	expect(expected).toBeDefined();
	if (expected.state === 'decoded') {
		expect(expected).toMatchObject({ sampleRate: 48_000, frames: 3840 });
		expect(expected.channels).toHaveLength(6);
	}
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading)); const project = JSON.parse(strFromU8(entries['project.json']));
	const source = project.sources.find(value => value.mimeType === 'audio/x-soundscaper-extracted');
	await expect(editor).toHaveAttribute('data-clip-count', source ? '2' : '1');
	if (!source) {
		expect(expected.state).not.toBe('decoded');
		expect(project.sources.filter(value => value.kind === 'video')).toHaveLength(1);
		const healthy = encodeWav([new Float32Array(4800).fill(.125)], { sampleRate: 48_000, bitDepth: 32, float: true });
		await editor.locator('[data-import-input]').setInputFiles({ name: 'Fresh healthy.wav', mimeType: 'audio/wav', buffer: Buffer.from(healthy) });
		await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 }); return;
	}
	expect(source).toMatchObject({ channelCount: 6, sampleRate: 48_000, originalSampleRate: 48_000 });
	const payloads = Object.entries(entries).filter(([name]) => name.endsWith('.f32c')); expect(payloads).toHaveLength(1);
	const pcm = Buffer.from(payloads[0][1]); expect(pcm.readUInt32LE(0)).toBe(source.frameCount);
	// Extraction retains the existing video-duration fit and its silent ending.
	expect(source.frameCount).toBeGreaterThanOrEqual(3840);
	expect(pcm.length).toBe(4 + source.frameCount * 6 * 4);
	for (let channel = 0; channel < 6; channel++) {
		const actual = Array.from({ length: source.frameCount }, (_, frame) => pcm.readFloatLE(4 + (channel * source.frameCount + frame) * 4));
		expect(Math.max(...actual)).toBeGreaterThan(.001);
		if (expected.state === 'decoded') {
			expect(actual.slice(0, expected.frames)).toEqual(expected.channels[channel]);
			expect(actual.slice(expected.frames).every(value => value === 0)).toBe(true);
		}
	}
});
