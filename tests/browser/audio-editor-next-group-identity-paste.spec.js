/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';

test('native groups with a reserved identifier survive ordinary Copy and Paste', async ({ page }) => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `next-project-fixture-${crypto.randomUUID()}` });
	let blob, destinationBlob;
	try {
		const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
		const project = createSoundscaperProject({ id: 'group-identity', sources: [source], tracks: [createAudioTrack({ id: 'voice', clipIds: ['first', 'second'] })],
			clips: [createAudioClip({ id: 'first', title: 'First', groupId: 'constructor', sourceId: source.id, durationFrames: 24_000, sourceDurationFrames: 24_000 }),
				createAudioClip({ id: 'second', title: 'Second', groupId: 'constructor', sourceId: source.id, timelineStartFrame: 24_000, sourceStartFrame: 24_000, durationFrames: 24_000, sourceDurationFrames: 24_000 })] });
		const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
		blob = (await exportScapeProject(project, store)).blob;
		destinationBlob = (await exportScapeProject(createSoundscaperProject({ id: 'group-destination' }), store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Grouped.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'group-identity'); await waitForProjectActivation(editor);
	await editor.locator('[data-clip-id="first"] .clip-header').click();
	await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Destination.sscape', mimeType: 'application/zip', buffer: Buffer.from(await destinationBlob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'group-destination'); await waitForProjectActivation(editor);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(editor.locator('[data-clip-id] .clip-header')).toHaveCount(2);
	await expect.poll(async () => (await persistedProject(page, 'group-destination'))?.clips[0]?.groupId).toEqual(expect.any(String));
	const saved = await persistedProject(page, 'group-destination');
	expect(saved.clips[0].groupId).toBe(saved.clips[1].groupId); expect(saved.clips[0].groupId).not.toBe('constructor');
	await chooseCommandAction(page, editor, 'Edit', 'Undo'); await expect(editor.locator('[data-clip-id] .clip-header')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo'); await expect(editor.locator('[data-clip-id] .clip-header')).toHaveCount(2);
});
