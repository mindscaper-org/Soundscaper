/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, chooseCommandAction, clipByName } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioTrack, createAudioClip, createAudioSource } from '../../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';

test('Delete and close gap per track works for clips anchored to beats', async ({ page }) => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false });
	let blob;
	try {
		const source = createAudioSource({ id: 'tone', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 });
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
		const project = createSoundscaperProject({ id: 'musical-ripple', sources: [source],
			tracks: [createAudioTrack({ id: 'voice', clipIds: ['first', 'later'] })], clips: [
				createAudioClip({ id: 'first', title: 'First', sourceId: source.id, anchor: 'musical', musicalStartBeat: 0,
					musicalExtent: 'beat', musicalDurationBeats: 2, sourceDurationFrames: 48_000 }),
				createAudioClip({ id: 'later', title: 'Later', sourceId: source.id, anchor: 'musical', musicalStartBeat: 8,
					musicalExtent: 'beat', musicalDurationBeats: 2, sourceDurationFrames: 48_000 }),
			] });
		blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Musical clips.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'musical-ripple');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
	await clipByName(editor, 'First').locator('.clip-header').click();
	await expect(clipByName(editor, 'First').locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Delete', 'Delete and close gap per track']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect.poll(async () => (await persistedProject(page, 'musical-ripple'))?.clips[0]?.musicalStartBeat).toEqual({ num: 6, den: 1 });
	await chooseCommandAction(page, editor, 'Edit', 'Undo'); await expect(editor).toHaveAttribute('data-clip-count', '2');
});
