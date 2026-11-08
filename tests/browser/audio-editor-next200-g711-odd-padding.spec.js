/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { nativeG711OddWavFixture } from '../helpers/native-g711-odd-wav-fixture.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

// Node owns the odd/even encoded-byte and decoder-port matrix. Keep both native
// codecs, both parities and the PCM control in one actual File Import/Save batch.
test('G.711 odd and even WAV imports retain every authored sample through Save', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const normalizations = new Map(), cases = [];
	for (const format of ['alaw', 'ulaw', 'alaw-even', 'ulaw-even', 'pcm']) {
		const codec = format.startsWith('ulaw') ? 'ulaw' : 'alaw';
		const fixture = nativeG711OddWavFixture(codec, format.endsWith('-even') ? 4800 : 4801);
		if (!normalizations.has(codec)) {
			// Authenticate native signed16 normalization against an untouched even producer.
			const control = nativeG711OddWavFixture(codec, 4800);
			const native = await page.evaluate(async bytes => {
				const audio = await new OfflineAudioContext(1, 1, 48_000).decodeAudioData(Uint8Array.from(bytes).buffer);
				return [...audio.getChannelData(0)];
			}, [...new Uint8Array(await control.file.arrayBuffer())]);
			expect(native).toHaveLength(4800);
			const normalization = [value => value, value => value > 0 ? value * 32768 / 32767 : value]
				.find(convert => native.every((sample, frame) => Math.abs(sample - convert(control.channel[frame])) < 1e-7));
			expect(normalization).toBeDefined(); normalizations.set(codec, normalization);
		}
		const bytes = format === 'pcm' ? encodeWav([fixture.channel], { sampleRate: 48_000, bitDepth: 32, float: true })
			: await fixture.file.arrayBuffer();
		cases.push({ file: { name: `${format}.wav`, mimeType: 'audio/wav', buffer: Buffer.from(bytes) },
			channel: fixture.channel, normalize: format === 'pcm' ? value => value : normalizations.get(codec) });
	}
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles(cases.map(({ file }) => file));
	await expect(editor).toHaveAttribute('data-clip-count', '5', { timeout: 30_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const files = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(files['project.json']));
	expect(project.sources).toHaveLength(cases.length);
	for (const { file, channel, normalize } of cases) {
		const source = project.sources.find(source => source.name === file.name); expect(source, file.name).toBeDefined();
		expect(source).toMatchObject({ sampleRate: 48_000, frameCount: channel.length, channelCount: 1 });
		const pcm = Buffer.from(files[`audio/${source.id}.f32c`]); expect(pcm.readUInt32LE(0)).toBe(channel.length);
		let error = 0;
		for (let frame = 0; frame < channel.length; frame++) error = Math.max(error, Math.abs(pcm.readFloatLE(4 + frame * 4) - normalize(channel[frame])));
		expect(error, file.name).toBeLessThan(1e-7);
	}
});
