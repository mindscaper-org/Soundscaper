/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { surroundAvWebmFixture } from '../helpers/ordinary-ogg-opus-fixture.ts';

test('File Import and native Save retain all six channels extracted from an ordinary video', async ({ page }) => {
	const file = await surroundAvWebmFixture(); const bytes = new Uint8Array(await file.arrayBuffer());
	await page.addInitScript(() => {
		// Observe the import's own native decode. A second context can have a
		// different WebKit decoder lifetime and changes the backend being tested.
		const decode = BaseAudioContext.prototype.decodeAudioData;
		BaseAudioContext.prototype.decodeAudioData = function (...args) {
			const result = decode.apply(this, args);
			void result.then(audio => {
				globalThis.__surroundNativeDecode = { supported: true, sampleRate: audio.sampleRate, frames: audio.length,
					channels: Array.from({ length: audio.numberOfChannels }, (_, channel) => [...audio.getChannelData(channel)]) };
			}, error => { globalThis.__surroundNativeDecode = { supported: false, error: `${error.name}: ${error.message}` }; });
			return result;
		};
	});
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(bytes) });
	await expect.poll(() => page.evaluate(() => Boolean(globalThis.__surroundNativeDecode)), { timeout: 30_000 }).toBe(true);
	const expected = await page.evaluate(() => globalThis.__surroundNativeDecode);
	if (expected.supported) { expect(expected).toMatchObject({ sampleRate: 48_000, frames: 3840 }); expect(expected.channels).toHaveLength(6); }
	await expect(editor).toHaveAttribute('data-clip-count', expected.supported ? '2' : '1', { timeout: 30_000 });
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading)); const project = JSON.parse(strFromU8(entries['project.json']));
	const source = project.sources.find(value => value.mimeType === 'audio/x-soundscaper-extracted');
	if (!expected.supported) {
		// This decoder cannot extract this AV profile; retain its video-only fallback and fresh-import ability.
		expect(source).toBeUndefined(); expect(project.sources.filter(value => value.kind === 'video')).toHaveLength(1);
		const healthy = encodeWav([new Float32Array(4800).fill(.125)], { sampleRate: 48_000, bitDepth: 32, float: true });
		await editor.locator('[data-import-input]').setInputFiles({ name: 'Fresh healthy.wav', mimeType: 'audio/wav', buffer: Buffer.from(healthy) });
		await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 30_000 }); return;
	}
	expect(source).toMatchObject({ channelCount: 6, sampleRate: 48_000, originalSampleRate: 48_000 });
	const payloads = Object.entries(entries).filter(([name]) => name.endsWith('.f32c')); expect(payloads).toHaveLength(1);
	const pcm = Buffer.from(payloads[0][1]); expect(pcm.readUInt32LE(0)).toBe(source.frameCount);
	// Extraction retains the existing video-duration fit and its silent ending.
	expect(source.frameCount).toBeGreaterThanOrEqual(expected.frames);
	expect(pcm.length).toBe(4 + source.frameCount * 6 * 4);
	for (let channel = 0; channel < 6; channel++) {
		expect(Math.max(...expected.channels[channel])).toBeGreaterThan(.001);
		const actual = Array.from({ length: source.frameCount }, (_, frame) => pcm.readFloatLE(4 + (channel * source.frameCount + frame) * 4));
		expect(actual.slice(0, expected.frames)).toEqual(expected.channels[channel]);
		expect(actual.slice(expected.frames).every(value => value === 0)).toBe(true);
	}
});
