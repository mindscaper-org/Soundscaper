/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('Paste creates a destination track in a lower-rate native project', async ({ page }) => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `next-project-fixture-${crypto.randomUUID()}` });
	let blob, destinationBlob;
	try {
		const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
		const project = createSoundscaperProject({ id: 'paste-track-rate', sources: [source],
			clips: [createAudioClip({ id: 'clip', title: 'Recording', sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000 })],
			tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
		blob = (await exportScapeProject(project, store)).blob;
		destinationBlob = (await exportScapeProject(createSoundscaperProject({ id: 'clipboard-24k', sampleRate: 24_000 }), store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Hidden stretch.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'paste-track-rate');
	await waitForProjectActivation(editor);
	await editor.locator('[data-clip-id="clip"] .clip-header').click();
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: '24k.sscape', mimeType: 'application/zip', buffer: Buffer.from(await destinationBlob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'clipboard-24k');
	await waitForProjectActivation(editor);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(editor.locator('[data-clip-id] .clip-header')).toHaveCount(1);
	await expect.poll(async () => (await persistedProject(page, 'clipboard-24k'))?.clips[0]?.durationFrames).toBe(24_000);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-clip-id] .clip-header')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor.locator('[data-clip-id] .clip-header')).toHaveCount(1);
});
