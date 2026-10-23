/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseFileAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
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


test('native surround WebM retains every channel through import and archive reopening', async ({ page, browser }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const file = surroundWebmOpusFixture();
	const expected = await page.evaluate(async bytes => {
		const context = new OfflineAudioContext(2, 1, 48_000);
		const input = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
		const channels = Array.from({ length: 6 }, (_, channel) => input.getChannelData(channel));
		return { nativeChannels: input.numberOfChannels, channels: channels.map(channel => [...channel]) };
	}, [...new Uint8Array(await file.arrayBuffer())]);
	expect(expected.nativeChannels).toBe(6);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type,
		buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const saved = await downloadBytes(await downloading);
	const entries = unzipSync(saved);
	const document = JSON.parse(strFromU8(entries['project.json']));
	expect(document.sources).toHaveLength(1);
	expect(document.sources[0]).toMatchObject({ sampleRate: 48_000, channelCount: 6, frameCount: 3840 });
	const records = Object.entries(entries).filter(([name]) => name.endsWith('.f32c'));
	expect(records).toHaveLength(1);
	const pcm = Buffer.from(records[0][1]);
	expect(pcm.readUInt32LE(0)).toBe(3840);
	for (let channel = 0; channel < 6; channel++) {
		let peak = 0, maximumError = 0;
		for (let frame = 0; frame < 3840; frame++) {
			const sample = pcm.readFloatLE(4 + (channel * 3840 + frame) * 4);
			peak = Math.max(peak, Math.abs(sample));
			maximumError = Math.max(maximumError, Math.abs(sample - expected.channels[channel][frame]));
		}
		const nativePeak = Math.max(...expected.channels[channel].map(Math.abs));
		expect(nativePeak).toBeGreaterThan(.01);
		expect(Math.abs(peak - nativePeak)).toBeLessThan(.00002);
		expect(maximumError).toBeLessThan(.00002);
	}
	await page.goto('about:blank');
	const freshContext = await browser.newContext({ serviceWorkers: 'block' });
	try {
		const reopenedPage = await freshContext.newPage();
		await disableNativeSavePicker(reopenedPage);
		const reopened = await bootEditor(reopenedPage, '/embed/en/');
		const choosing = reopenedPage.waitForEvent('filechooser');
		await chooseFileAction(reopenedPage, reopened, 'Open');
		await (await choosing).setFiles({ name: 'Surround.sscape', mimeType: 'application/zip', buffer: Buffer.from(saved) });
		await expect(reopened).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
		await waitForProjectActivation(reopened);
		const downloadingAgain = reopenedPage.waitForEvent('download');
		await chooseExportProjectFileAction(reopenedPage, reopened);
		const reopenedEntries = unzipSync(await downloadBytes(await downloadingAgain));
		const reopenedDocument = JSON.parse(strFromU8(reopenedEntries['project.json']));
		expect(reopenedDocument.sources[0]).toMatchObject({ sampleRate: 48_000, channelCount: 6, frameCount: 3840 });
		expect(Object.entries(reopenedEntries).find(([name]) => name.endsWith('.f32c'))[1]).toEqual(records[0][1]);
	} finally { await freshContext.close(); }
});
