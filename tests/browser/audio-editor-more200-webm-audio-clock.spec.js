/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { ordinaryWebmOpusFixture, surroundWebmOpusFixture, taggedWebmOpusFixture } from '../helpers/ordinary-ogg-opus-fixture.ts';

for (const extension of ['webm', 'mka']) test(`File Import preserves the native 48 kHz Opus clock in audio-only ${extension}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const file = await ordinaryWebmOpusFixture(extension);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type,
		buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	expect(document.sources).toHaveLength(1);
	expect(document.sources[0].sampleRate).toBe(48_000);
	expect(document.sources[0].channelCount).toBe(1);
	expect(document.sources[0].frameCount).toBeGreaterThan(24_000);
});

for (const target of ['global', 'all-tracks']) test(`File Import retains WebM ${target} title and artist metadata`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const file = await taggedWebmOpusFixture(target);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type,
		buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	const contribution = document.sources[0].provenance.contributions[0];
	expect(contribution.warnings).toEqual([]);
	expect(contribution.metadata.normalized.title).toBe('Authored global title');
	expect(contribution.metadata.normalized.artist).toBe('Ada — reviewed credit');
	expect(document.sources[0].sampleRate).toBe(48_000);
});


test('native surround WebM keeps the existing stereo import fallback and source clock', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const file = surroundWebmOpusFixture();
	const expected = await page.evaluate(async bytes => {
		const context = new OfflineAudioContext(2, 1, 48_000);
		const input = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
		const channels = Array.from({ length: 6 }, (_, channel) => input.getChannelData(channel));
		return { nativeChannels: input.numberOfChannels, channels: [0, 1].map(side => Array.from(channels[side],
			(value, frame) => Math.fround(value * .5 + channels[2][frame] * Math.SQRT1_2 * .5 + channels[side + 4][frame] * Math.SQRT1_2 * .5))) };
	}, [...new Uint8Array(await file.arrayBuffer())]);
	expect(expected.nativeChannels).toBe(6);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type,
		buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading));
	const document = JSON.parse(strFromU8(entries['project.json']));
	expect(document.sources).toHaveLength(1);
	expect(document.sources[0]).toMatchObject({ sampleRate: 48_000, channelCount: 2, frameCount: 3840 });
	const records = Object.entries(entries).filter(([name]) => name.endsWith('.f32c'));
	expect(records).toHaveLength(1);
	const pcm = Buffer.from(records[0][1]);
	expect(pcm.readUInt32LE(0)).toBe(3840);
	for (let channel = 0; channel < 2; channel++) {
		let peak = 0, maximumError = 0;
		for (let frame = 0; frame < 3840; frame++) {
			const sample = pcm.readFloatLE(4 + (channel * 3840 + frame) * 4);
			peak = Math.max(peak, Math.abs(sample));
			maximumError = Math.max(maximumError, Math.abs(sample - expected.channels[channel][frame]));
		}
		expect(peak).toBeGreaterThan(.1);
		expect(maximumError).toBeLessThan(.00002);
	}
});
