/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { surroundVorbisFixture, surroundVorbisReference, singlePageSurroundVorbisFixture } from '../helpers/surround-vorbis-fixture.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

for (const channelCount of [2, 6]) test(`File Import preserves ${channelCount} channel Vorbis PCM and authored final granule`, async ({ page, browserName }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const file = surroundVorbisFixture(channelCount), bytes = new Uint8Array(await file.arrayBuffer());
	const native = await page.evaluate(async bytes => {
		const decoded = await new OfflineAudioContext(6, 1, 48_000).decodeAudioData(Uint8Array.from(bytes).buffer);
		return { frames: decoded.length, channels: Array.from({ length: decoded.numberOfChannels }, (_, index) => [...decoded.getChannelData(index)]) };
	}, [...bytes]);
	expect(native.channels).toHaveLength(channelCount);
	expect([4800, 4801]).toContain(native.frames);
	// A010 also normalizes Firefox's encoded Vorbis planes to canonical speaker order.
	const expected = channelCount === 6 ? surroundVorbisReference() : native.channels.map(channel => channel.slice(0, 4800));
	const nativePlanes = channelCount === 6 && browserName === 'firefox' ? [0, 2, 1, 5, 3, 4] : Array.from({ length: channelCount }, (_, index) => index);
	let nativeError = 0;
	for (let channel = 0; channel < channelCount; channel++) for (let frame = 0; frame < 4800; frame++) {
		nativeError = Math.max(nativeError, Math.abs(native.channels[nativePlanes[channel]][frame] - expected[channel][frame]));
	}
	expect(nativeError).toBeLessThan(1e-6);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(bytes) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 10_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading)), project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources[0]).toMatchObject({ channelCount, sampleRate: 48_000, frameCount: 4800 });
	const pcm = Buffer.from(Object.entries(entries).find(([key]) => key.endsWith('.f32c'))[1]);
	let maximumError = 0;
	for (let channel = 0; channel < channelCount; channel++) for (let frame = 0; frame < 4800; frame++) {
		maximumError = Math.max(maximumError, Math.abs(pcm.readFloatLE(4 + (channel * 4800 + frame) * 4) - expected[channel][frame]));
	}
	expect(maximumError).toBeLessThan(1e-6);
});


test('WebKit refuses an ambiguous single-page surround source instead of leaving Import busy', async ({ page, browserName }) => {
	test.skip(browserName !== 'webkit', 'The unchanged packet backends remain supported.');
	const editor = await bootEditor(page, '/embed/en/'); const file = await singlePageSurroundVorbisFixture();
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor.getByRole('alert')).toContainText('cannot import this surround Vorbis source');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	const retry = surroundVorbisFixture(6);
	await editor.locator('[data-import-input]').setInputFiles({ name: retry.name, mimeType: retry.type, buffer: Buffer.from(await retry.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 10_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
});
