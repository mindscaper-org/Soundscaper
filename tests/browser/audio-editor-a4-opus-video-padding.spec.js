/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { opusPaddingAvFixture } from '../helpers/ordinary-ogg-opus-fixture.ts';

for (const padded of [false, true]) test(`video File Import discards final Opus encoder padding (bounded=${padded})`, async ({ page, browserName }) => {
	// Firefox may exhaust both existing disposable15s poster/thumbnail seek waits.
	if (padded) test.setTimeout(60_000);
	const file = opusPaddingAvFixture(padded ? 32 * 1024 ** 2 : 0);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const expected = await page.evaluate(async bytes => {
		const context = new OfflineAudioContext(1, 1, 48_000);
		const decoded = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
		return [...decoded.getChannelData(0)];
	}, [...new Uint8Array(await opusPaddingAvFixture().arrayBuffer())]);
	expect(expected).toHaveLength(4800);
	expect(Math.max(...expected.map(Math.abs))).toBeGreaterThan(.1);
	// This native WebKit oracle returns S16 PCM; retain its proven half-LSB rounding bound.
	if (browserName === 'webkit') expect(expected.every(value => Number.isInteger(value * 32768))).toBe(true);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: padded ? 45_000 : 15_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await downloading));
	const project = JSON.parse(strFromU8(entries['project.json']));
	const source = project.sources.find(value => value.mimeType === 'audio/x-soundscaper-extracted');
	expect(source).toMatchObject({ channelCount: 1, sampleRate: 48_000, frameCount: 14_400 });
	const payload = Buffer.from(Object.entries(entries).find(([name]) => name.endsWith('.f32c'))[1]);
	const samples = Array.from({ length: source.frameCount }, (_, frame) => payload.readFloatLE(4 + frame * 4));
	// The authored first picture is7ms after the audio: retain the existing picture-relative placement.
	const aligned = expected.slice(336);
	let maximumError = 0;
	for (let frame = 0; frame < aligned.length; frame++) maximumError = Math.max(maximumError, Math.abs(samples[frame] - aligned[frame]));
	expect(maximumError).toBeLessThan(browserName === 'webkit' ? 1 / 65536 + .0000001 : .000001);
	expect(Math.max(...samples.slice(aligned.length).map(Math.abs))).toBeLessThan(.000001);
});
