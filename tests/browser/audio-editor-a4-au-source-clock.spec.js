/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { encodeWav } from '../../src/common/editor/wav.js';
import { sunPcmAu48_000Fixture } from '../helpers/os-audio-codec-fixtures.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

for (const format of ['au', 'wav']) test(`native ${format} File Import retains its source clock on a44.1k output device`, async ({ page }) => {
	await page.addInitScript(() => {
		const Native = globalThis.AudioContext;
		globalThis.AudioContext = class extends Native {
			constructor(options) { super({ ...options, sampleRate: options?.sampleRate ?? 44_100 }); }
		};
	});
	const tone = Float32Array.from({ length: 4800 }, (_, frame) => Math.sin(2 * Math.PI * 997 * frame / 48_000) * .2);
	const file = format === 'au' ? sunPcmAu48_000Fixture()
		: new File([Uint8Array.from(encodeWav([tone], { sampleRate: 48_000 }))], 'Control.wav', { type: 'audio/wav' });
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const expected = await page.evaluate(async bytes => {
		try {
			const context = new OfflineAudioContext(1, 1, 48_000);
			const result = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
			return [...result.getChannelData(0)];
		} catch { return null; }
	}, [...new Uint8Array(await file.arrayBuffer())]);
	test.skip(expected === null, 'This native platform does not decode this audio profile; no new decoder is offered.');
	expect(expected).toHaveLength(4800);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1'); await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const pending = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await pending)), project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources[0]).toMatchObject({ sampleRate: 48_000, frameCount: 4800, channelCount: 1 });
	const pcm = Buffer.from(Object.entries(entries).find(([key]) => key.endsWith('.f32c'))[1]);
	let maximumError = 0;
	for (let frame = 0; frame < 4800; frame++) maximumError = Math.max(maximumError, Math.abs(pcm.readFloatLE(4 + frame * 4) - expected[frame]));
	expect(maximumError).toBeLessThan(1e-7);
});
