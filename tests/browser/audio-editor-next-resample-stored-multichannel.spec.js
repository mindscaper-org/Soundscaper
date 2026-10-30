/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, openClipProperties } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { expectClipSampleRate, resampleClipFormat } from './audio-editor-clip-settings-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('Clip Resample reads a long stored surround recording without dropping channels', async ({ page }) => {
	test.setTimeout(120_000);
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 1_440_000, channelCount: 6 });
	const project = createSoundscaperProject({ id: 'stored-surround', sources: [source],
		clips: [createAudioClip({ id: 'clip', title: 'Surround recording', sourceId: source.id, durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let blob;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let offset = 0; offset < source.frameCount; offset += 65_536) await writer.write(Array.from({ length: 6 }, (_, channel) => new Float32Array(Math.min(65_536, source.frameCount - offset)).fill((channel + 1) / 16)));
		await writer.commit(); blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Surround.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id, { timeout: 60_000 });
	await expect(editor).not.toHaveAttribute('data-project-activation-pending', 'true');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
	const properties = await openClipProperties(page, editor, editor.locator('[data-clip-id="clip"]').first());
	await resampleClipFormat(properties, 24_000);
	// Wait for the stored six-channel replacement to be saved before Undo.
	await expect.poll(async () => {
		const current = await persistedProject(page, project.id);
		const sourceId = current?.clips[0]?.sourceId;
		const output = current?.sources.find(value => value.id === sourceId);
		return [output?.sampleRate, output?.frameCount, output?.channelCount];
	}, { timeout: 60_000 }).toEqual([24_000, 720_000, 6]);
	await expectClipSampleRate(properties, 24_000);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expectClipSampleRate(properties, 48_000);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expectClipSampleRate(properties, 24_000);
});
