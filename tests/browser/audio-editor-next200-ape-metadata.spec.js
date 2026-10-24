/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { nativeApeMetadataFixture, APE_METADATA_CREDITS } from '../helpers/native-ape-metadata-fixture.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';

for (const format of ['ape', 'wav']) test(`File Import retains authored credits through native Save: ${format}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const ape = nativeApeMetadataFixture();
	const file = format === 'ape' ? ape : new File([Uint8Array.from(encodeWav([new Float32Array(4800).fill(.2)],
		{ sampleRate: 48_000, metadata: APE_METADATA_CREDITS }))], 'Control.wav', { type: 'audio/wav' });
	const bytes = new Uint8Array(await file.arrayBuffer());
	const native = await page.evaluate(async input => {
		try { const audio = await new OfflineAudioContext(2, 1, 32_000).decodeAudioData(Uint8Array.from(input).buffer);
			return { frames: audio.length, channels: audio.numberOfChannels }; } catch { return null; }
	}, [...bytes]);
	if (format === 'wav') expect(native).not.toBeNull();
	test.skip(native === null, 'This platform does not decode Monkey audio; no decoder is added.');
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(bytes) });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const archive = unzipSync(await downloadBytes(await saving));
	const project = JSON.parse(strFromU8(archive['project.json']));
	expect(project.clips).toHaveLength(1);
	const contribution = project.sources[0].provenance.contributions[0];
	expect(contribution.warnings).toEqual([]);
	expect(contribution.metadata.normalized).toMatchObject(APE_METADATA_CREDITS);
});
