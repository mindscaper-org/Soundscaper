/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { nativeG711OddWavFixture } from '../helpers/native-g711-odd-wav-fixture.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

for (const format of ['alaw', 'ulaw', 'alaw-even', 'ulaw-even', 'pcm']) test(`${format} WAV retains its authored mono frames completes File Import and Save`, async ({ page }) => {
	test.setTimeout(30_000);
	const fixture = nativeG711OddWavFixture(format.startsWith('ulaw') ? 'ulaw' : 'alaw', format.endsWith('-even') ? 4800 : 4801), channel = fixture.channel;
	const file = format !== 'pcm' ? fixture.file : new File([Uint8Array.from(encodeWav([channel], { sampleRate: 48_000, bitDepth: 32, float: true }))], 'Control.wav', { type: 'audio/wav' });
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	// G.711 emits signed16 PCM. Browsers use either a symmetric32768 grid
	// or positive32767/negative32768; authenticate the backend against a separate untouched even producer.
	const control = nativeG711OddWavFixture(format.startsWith('ulaw') ? 'ulaw' : 'alaw', 4800);
	const nativeControl = await page.evaluate(async bytes => {
		const audio = await new OfflineAudioContext(1, 1, 48_000).decodeAudioData(Uint8Array.from(bytes).buffer);
		return [...audio.getChannelData(0)];
	}, [...new Uint8Array(await control.file.arrayBuffer())]);
	expect(nativeControl).toHaveLength(4800);
	const normalizations = [value => value, value => value > 0 ? value * 32768 / 32767 : value];
	const normalization = normalizations.find(convert => nativeControl.every((sample, frame) => Math.abs(sample - convert(control.channel[frame])) < 1e-7));
	expect(normalization).toBeDefined();
	const nativeSample = format === 'pcm' ? value => value : normalization;

	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 10_000 });
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.sources[0]).toMatchObject({ sampleRate: 48_000, frameCount: channel.length, channelCount: 1 });
	const pcm = Buffer.from(entries[`audio/${project.sources[0].id}.f32c`]);
	let error = 0;
	for (let frame = 0; frame < channel.length; frame++) error = Math.max(error, Math.abs(pcm.readFloatLE(4 + frame * 4) - nativeSample(channel[frame])));
	expect(error).toBeLessThan(1e-7);
});
