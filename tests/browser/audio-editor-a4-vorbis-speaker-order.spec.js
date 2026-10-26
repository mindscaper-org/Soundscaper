/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { surroundVorbisFixture, surroundVorbisReference } from '../helpers/surround-vorbis-fixture.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseDropdown, chooseExportProjectFileAction, disableNativeSavePicker,
	downloadBytes, openExportDialog, readDownloadBytes, waitForProjectActivation,
} from './audio-editor-test-helpers.js';

for (const generic of [false, true]) test(`six-channel Vorbis keeps canonical speaker roles through ${generic ? 'native' : 'packet'} import, Save and WAV export`, async ({ page, browserName }) => {
	test.skip(generic && browserName !== 'firefox', 'The qualified native channel-order difference is Firefox specific.');
	test.setTimeout(60_000); await disableNativeSavePicker(page);
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, 'launchQueue', {
			configurable: true, value: { setConsumer(consumer) { globalThis.__vorbisRoleOpen = consumer; } },
		});
		const binding = Object.getOwnPropertyDescriptor(AudioBufferSourceNode.prototype, 'buffer');
		globalThis.__vorbisNativeBuffers = [];
		Object.defineProperty(AudioBufferSourceNode.prototype, 'buffer', { ...binding, set(buffer) {
			binding.set.call(this, buffer);
			if (buffer) globalThis.__vorbisNativeBuffers.push({ native: buffer instanceof AudioBuffer, channels: buffer.numberOfChannels, frames: buffer.length });
		} });
	});
	const editor = await bootEditor(page, '/embed/en/'), reference = surroundVorbisReference(), outputs = [];
	for (const format of ['wav', 'vorbis']) {
		const project = createSoundscaperProject({ id: `a4-010-${String(generic)}-${format}`, sampleRate: 48_000, masterChannels: 6 });
		const archive = await createSoundscaperScapeNativeRuntime().exportScapeProject(project, {
			async getMediaAssetMetadata() { return null; }, async loadMediaAsset() { return null; },
			readSourceChunks() { return (async function* () {})(); },
		});
		await page.evaluate(async bytes => {
			const file = new File([Uint8Array.from(bytes)], 'Programme.sscape', { type: 'application/x-scape-project' });
			await globalThis.__vorbisRoleOpen({ files: [{ kind: 'file', getFile: () => Promise.resolve(file) }] });
		}, [...new Uint8Array(await archive.blob.arrayBuffer())]);
		await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
		const file = format === 'wav'
			? new File([Uint8Array.from(encodeWav(reference, { sampleRate: 48_000, bitDepth: 32, float: true }))], 'Reference.wav', { type: 'audio/wav' })
			: new File([surroundVorbisFixture(6)], generic ? 'Recording.bin' : 'Recording.ogg', { type: generic ? 'application/octet-stream' : 'audio/ogg' });
		await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 10_000 });
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
		const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
		const entries = unzipSync(await downloadBytes(await saving)), saved = JSON.parse(strFromU8(entries['project.json']));
		expect(saved.masterChannels).toBe(6);
		expect(saved.sources[0]).toMatchObject({ sampleRate: 48_000, channelCount: 6, frameCount: 4800 });
		const source = Buffer.from(Object.entries(entries).find(([name]) => name.endsWith('.f32c'))[1]);
		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '32-bit Float');
		await page.evaluate(() => { globalThis.__vorbisNativeBuffers = []; });
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 20_000 });
		const wave = await readDownloadBytes(page, link), descriptor = await inspectWavBlobPcm(new Blob([wave]));
		expect(descriptor).toMatchObject({ sampleRate: 48_000, channelCount: 6, frameCount: 4800 });
		// The real renderer must submit a native buffer, including when import skipped its optional cache.
		expect(await page.evaluate(() => globalThis.__vorbisNativeBuffers)).toContainEqual({ native: true, channels: 6, frames: 4800 });
		const rendered = await page.evaluate(async bytes => {
			const decoded = await new OfflineAudioContext(6, 1, 48_000).decodeAudioData(Uint8Array.from(bytes).buffer);
			return Array.from({ length: decoded.numberOfChannels }, (_, channel) => [...decoded.getChannelData(channel)]);
		}, [...wave]);
		outputs.push({ source, rendered }); await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	}
	for (let channel = 0; channel < 6; channel++) {
		let storedError = 0, renderedError = 0;
		for (let frame = 0; frame < 4800; frame++) {
			storedError = Math.max(storedError, Math.abs(outputs[1].source.readFloatLE(4 + (channel * 4800 + frame) * 4) - reference[channel][frame]));
			renderedError = Math.max(renderedError, Math.abs(outputs[1].rendered[channel][frame] - outputs[0].rendered[channel][frame]));
		}
		expect.soft(storedError, `canonical source speaker ${String(channel)}`).toBeLessThan(1e-6);
		expect.soft(renderedError, `delivered WAVE speaker ${String(channel)}`).toBeLessThan(1e-6);
	}
});
