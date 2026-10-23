/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { surroundAvWebmFixture } from '../helpers/ordinary-ogg-opus-fixture.ts';

test('File Import and native Save retain all six channels extracted from an ordinary video', async ({ page }) => {
	const file = await surroundAvWebmFixture(); const bytes = new Uint8Array(await file.arrayBuffer());
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const expected = await page.evaluate(async data => {
		try {
			const context = new OfflineAudioContext(6, 1, 48_000); const audio = await context.decodeAudioData(Uint8Array.from(data).buffer);
			return { supported: true, sampleRate: audio.sampleRate, frames: audio.length, channels: Array.from({ length: audio.numberOfChannels }, (_, channel) => [...audio.getChannelData(channel)]) };
		} catch (error) { return { supported: false, error: `${error.name}: ${error.message}` }; }
	}, [...bytes]);
	if (expected.supported) { expect(expected).toMatchObject({ sampleRate: 48_000, frames: 3840 }); expect(expected.channels).toHaveLength(6); }
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(bytes) });
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
