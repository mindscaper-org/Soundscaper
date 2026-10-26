/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, openExportDialog, readDownloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';

for (const sampleRate of [24_000, 48_000, 96_000, 768_000]) test(`a ${sampleRate}Hz original slowed to one source sample per output frame exports its exact PCM`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const source = createAudioSource({ id: 'source', name: 'Linked speed.wav', sampleRate, channelCount: 1, frameCount: 76_800 });
	const samples = Float32Array.from({ length: source.frameCount }, (_, frame) => .2 * Math.sin(2 * Math.PI * 220 * frame / 48_000));
	const project = createSoundscaperProject({ id: `native-speed-${sampleRate}`, sampleRate: 48_000, sources: [source],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })], clips: [createAudioClip({ id: 'clip', sourceId: source.id,
			title: 'Linked speed', durationFrames: 76_800, sourceDurationFrames: 76_800, speedRatio: 48_000 / sampleRate, linkPitchAndTempo: true })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let archive;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let offset = 0; offset < samples.length; offset += 65_536) await writer.write([samples.subarray(offset, offset + 65_536)]);
		await writer.commit(); archive = (await createSoundscaperScapeNativeRuntime().exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Linked speed.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const dialog = await openExportDialog(page, editor);
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 30_000 });
	const bytes = Buffer.from(await readDownloadBytes(page, link)); let data, format;
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const size = bytes.readUInt32LE(offset + 4), id = bytes.toString('ascii', offset, offset + 4);
		if (id === 'fmt ') format = bytes.subarray(offset + 8, offset + 8 + size);
		if (id === 'data') data = bytes.subarray(offset + 8, offset + 8 + size);
		offset += 8 + size + (size & 1);
	}
	expect(format.readUInt32LE(4)).toBe(48_000); expect(format.readUInt16LE(14)).toBe(24);
	const frameBytes = format.readUInt16LE(12); expect(data.length / frameBytes).toBe(76_800);
	let error = 0;
	for (let frame = 256; frame < samples.length - 256; frame++) error = Math.max(error,
		Math.abs(data.readIntLE(frame * frameBytes, 3) / 8_388_608 - samples[frame] * Math.SQRT1_2));
	expect(error).toBeLessThan(.000002);
});
