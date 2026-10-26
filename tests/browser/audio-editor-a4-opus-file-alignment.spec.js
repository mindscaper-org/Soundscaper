/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { encodeDedicatedAudioPcm } from '../../src/common/editor/browser-dedicated-audio-codec.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

test('ordinary Opus File Import keeps native whole-file alignment', async ({ page, browserName }) => {
	const pcm = Float32Array.from({ length: 4800 }, (_, frame) => Math.sin(2 * Math.PI * 997 * frame / 48_000) * .2);
	const encoded = await encodeDedicatedAudioPcm({ format: 'opus', input: new Uint8Array(pcm.buffer), frameCount: pcm.length,
		channelCount: 1, sampleRate: 48_000, settings: { bitrateKbps: 96, vbrMode: 1 }, maximumOutputBytes: 1024 ** 2 },
	{ loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
	const file = new File([Uint8Array.from(encoded)], 'Programme.opus', { type: 'audio/ogg' });
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const expected = await page.evaluate(async bytes => {
		const context = new OfflineAudioContext(1, 1, 48_000);
		const result = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
		return [...result.getChannelData(0)];
	}, [...new Uint8Array(await file.arrayBuffer())]);
	expect(expected).toHaveLength(pcm.length); expect(Math.max(...expected.map(Math.abs))).toBeGreaterThan(.1);
	if (browserName === 'webkit') expect(expected.every(value => Number.isInteger(value * 32768))).toBe(true);
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1'); await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const pending = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await pending)); const project = JSON.parse(strFromU8(entries['project.json']));
	const source = project.sources[0]; expect(source).toMatchObject({ sampleRate: 48_000, channelCount: 1, frameCount: expected.length });
	const payload = Buffer.from(Object.entries(entries).find(([key]) => key.endsWith('.f32c'))[1]);
	let maximumError = 0;
	for (let frame = 0; frame < expected.length; frame++) maximumError = Math.max(maximumError, Math.abs(payload.readFloatLE(4 + frame * 4) - expected[frame]));
	expect(maximumError).toBeLessThan(browserName === 'webkit' ? 1 / 65536 + 1e-7 : 1e-6);
});
