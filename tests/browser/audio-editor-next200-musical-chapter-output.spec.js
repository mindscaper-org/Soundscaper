/* SPDX-License-Identifier: AGPL-3.0-only */

import { unzipSync } from 'fflate';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, openExportDialog,
	readDownloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';

for (const musical of [true, false]) {
	test(`File Open offers and writes the ${musical ? 'musical' : 'sample'} chapter across a tempo change`, async ({ page }) => {
		const source = createAudioSource({ id: 'take', sampleRate: 48_000, frameCount: 192_000, channelCount: 1 });
		const project = createSoundscaperProject({ id: `chapter-file-${String(musical)}`, sampleRate: 48_000,
			tempoMap: { mode: 'musical', events: [
				{ id: 'head', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
				{ id: 'change', beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } },
			] }, sources: [source], clips: [createAudioClip({ id: 'clip', sourceId: source.id,
				durationFrames: 192_000, sourceDurationFrames: 192_000 })], tracks: [
				createAudioTrack({ id: 'voice', clipIds: ['clip'] }),
				{ id: 'labels', type: 'label', name: 'Chapters', labels: [{ id: 'span', title: 'Across change',
					...(musical ? { anchor: 'musical', startBeat: { num: 3, den: 1 }, endBeat: { num: 5, den: 1 } }
						: { startFrame: 72_000, endFrame: 144_000 }) }] },
			] });
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `chapter-fixture-${crypto.randomUUID()}` });
		let buffer;
		try {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			for (let offset = 0; offset < source.frameCount; offset += 65_536) {
				await writer.write([new Float32Array(Math.min(65_536, source.frameCount - offset)).fill(.25)]);
			}
			await writer.commit();
			const archive = await createSoundscaperScapeNativeRuntime().exportScapeProject(project, store);
			buffer = Buffer.from(await archive.blob.arrayBuffer());
		} finally { await store.close(); }
		await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
		await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Chapter.sscape', mimeType: 'application/zip', buffer });
		await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
		const dialog = await openExportDialog(page, editor);
		const output = dialog.locator('[data-export-field="output"]');
		await output.getByRole('button').click();
		await expect(page.getByRole('option', { name: 'Chapters (split by labels)', exact: true })).toBeEnabled();
		await page.getByRole('option', { name: 'Chapters (split by labels)', exact: true }).click();
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const link = dialog.locator('[data-export-download]'); await expect(link).toBeVisible({ timeout: 30_000 });
		const archive = unzipSync(await readDownloadBytes(page, link));
		expect(Object.keys(archive)).toEqual(['01-Across-change.wav']);
		const wav = new Blob([archive['01-Across-change.wav']]);
		const descriptor = await inspectWavBlobPcm(wav);
		expect(descriptor.sampleRate).toBe(48_000); expect(descriptor.frameCount).toBe(72_000);
		let frames = 0; let maxError = 0;
		await streamWavBlobPcm(wav, { onChunk: channels => {
			frames += channels[0].length;
			for (const sample of channels[0]) maxError = Math.max(maxError, Math.abs(sample - .25 * Math.SQRT1_2));
		} });
		expect(frames).toBe(72_000); expect(maxError).toBeLessThan(.000001);
	});
}
