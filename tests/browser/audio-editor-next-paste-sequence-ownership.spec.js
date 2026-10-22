/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioSource, createAudioTrack, createAudioClip } from '../../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';

test('Copy and Paste at a sequence boundary keep both copied tracks in one sequence', async ({ page }) => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `next-project-fixture-${crypto.randomUUID()}` });
	let blob;
	try {
		const source = createAudioSource({ id: 'tone', name: 'Tone', frameCount: 48_000, channelCount: 1, sampleRate: 48_000 });
		const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
		const tracks = ['A', 'B', 'Foreign'].map(id => createAudioTrack({ id, name: id, clipIds: [`clip-${id}`] }));
		const project = createSoundscaperProject({ id: 'paste-sequences', sources: [source], tracks,
			clips: tracks.map(track => createAudioClip({ id: `clip-${track.id}`, title: track.id, sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000 })),
			sequences: [{ id: 'main', trackIds: ['A', 'B'] }, { id: 'other', trackIds: ['Foreign'] }], primarySequenceId: 'main' });
		blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Sequences.sscape', mimeType: 'application/vnd.soundscaper.scape+zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'paste-sequences');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
	await expect(editor.locator('[data-clip-id]')).toHaveCount(3);
	await waitForProjectActivation(editor);
	await clipByName(editor, 'A').locator('.clip-header').click();
	await expect(clipByName(editor, 'A').locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await clipByName(editor, 'B').locator('.clip-header').click({ modifiers: ['Shift'] });
	await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await clipByName(editor, 'B').locator('xpath=ancestor::div[@data-track-row]').locator('.track-control-panel__track-name-text').click();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(editor.locator('[data-clip-id]')).toHaveCount(5);
	await expect(clipByName(editor, 'Foreign').locator('xpath=ancestor::div[@data-track-row]').locator('[data-clip-id]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-clip-id]')).toHaveCount(3);
});
