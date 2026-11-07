/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { nativeApeMetadataFixture, nativeTtaMetadataFixture, APE_METADATA_CREDITS } from '../helpers/native-ape-metadata-fixture.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

// Node covers each format's metadata and archive custody independently. Every
// native codec supported by this platform still crosses the real browser decoder.
test('File Import and native Save retain authored credits across available APE/TTA codecs and WAV', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const supported = [];
	for (const format of ['ape', 'tta', 'wav']) {
		const file = format === 'ape' ? nativeApeMetadataFixture() : format === 'tta' ? nativeTtaMetadataFixture()
			: new File([Uint8Array.from(encodeWav([new Float32Array(4800).fill(.2)], { sampleRate: 48_000, metadata: APE_METADATA_CREDITS }))], 'Control.wav', { type: 'audio/wav' });
		const bytes = new Uint8Array(await file.arrayBuffer());
		const native = await page.evaluate(async input => {
			try { const audio = await new OfflineAudioContext(2, 1, 32_000).decodeAudioData(Uint8Array.from(input).buffer);
				return { frames: audio.length, channels: audio.numberOfChannels }; } catch { return null; }
		}, [...bytes]);
		if (format === 'wav') expect(native).not.toBeNull();
		if (native === null) {
			test.info().annotations.push({ type: 'native-codec-unavailable', description: format });
			continue;
		}
		supported.push({ format, file: { name: file.name, mimeType: file.type, buffer: Buffer.from(bytes) } });
	}
	expect(supported.some(({ format }) => format === 'wav')).toBe(true);
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles(supported.map(({ file }) => file));
	await expect(editor).toHaveAttribute('data-clip-count', String(supported.length), { timeout: 30_000 });
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const files = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(files['project.json']));
	expect(project.clips).toHaveLength(supported.length); expect(project.sources).toHaveLength(supported.length);
	for (const { format, file } of supported) {
		const source = project.sources.find(source => source.name === file.name); expect(source, file.name).toBeDefined();
		expect(source).toMatchObject({ sampleRate: format === 'tta' ? 96_000 : format === 'ape' ? 32_000 : 48_000, frameCount: 4800 });
		const contribution = source.provenance.contributions[0];
		expect(contribution.warnings).toEqual([]); expect(contribution.metadata.normalized).toMatchObject(APE_METADATA_CREDITS);
	}
});
