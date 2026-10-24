/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeDialog, collectClientErrors, disableNativeSavePicker,
	openExportDialog, readDownloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../../src/common/editor/wav-import.js';

test('cross-rate Copy and Paste keeps the audible gain after two envelope points merge', async ({ page }) => {
	const source = createAudioSource({ id: 'recording', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const original = createSoundscaperProject({ id: 'paste-envelope-origin', sources: [source],
		clips: [createAudioClip({ id: 'clip', title: 'Envelope', sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000,
			envelope: [{ frame: 0, value: .2 }, { frame: 10_001, value: .1 }, { frame: 10_002, value: .9 }, { frame: 48_000, value: .9 }] })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })] });
	const destination = createSoundscaperProject({ id: 'paste-envelope-destination', sampleRate: 24_000 });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	const files = [];
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
		for (const project of [original, destination]) {
			const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
			files.push({ name: `${project.id}.sscape`, mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) });
		}
	} finally { await store.close(); }
	const errors = collectClientErrors(page); await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(files[0]);
	await expect(editor).toHaveAttribute('data-project-id', original.id, { timeout: 30_000 }); await waitForProjectActivation(editor);
	await editor.locator('[data-clip-id="clip"]').first().press('Enter');
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await editor.locator('[data-aup4-input]').setInputFiles(files[1]);
	await expect(editor).toHaveAttribute('data-project-id', destination.id, { timeout: 30_000 }); await waitForProjectActivation(editor);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const dialog = await openExportDialog(page, editor);
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = dialog.locator('[data-export-download]'); await expect(download).toBeVisible();
	const file = new Blob([await readDownloadBytes(page, download)]);
	const descriptor = await inspectWavBlobPcm(file);
	expect(descriptor.sampleRate).toBe(24_000); expect(descriptor.frameCount).toBe(24_000);
	const output = new Float32Array(descriptor.frameCount); let offset = 0;
	await streamWavBlobPcm(file, { descriptor, onChunk(channels) { output.set(channels[0], offset); offset += channels[0].length; } });
	await closeDialog(dialog);
	const expected = .25 * .9 * Math.SQRT1_2;
	const error = Math.max(...output.slice(15_000, 22_500).map(sample => Math.abs(sample - expected)));
	expect(error).toBeLessThan(.0001);
	await chooseCommandAction(page, editor, 'Edit', 'Undo'); await expect(editor).toHaveAttribute('data-clip-count', '0');
	await chooseCommandAction(page, editor, 'Edit', 'Redo'); await expect(editor).toHaveAttribute('data-clip-count', '1');
	expect(errors).toEqual([]);
});
