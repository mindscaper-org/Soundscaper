/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';

test('Edit Duplicate keeps a secondary recording and its new lane in that sequence', async ({ page }) => {
	const source = createAudioSource({ id: 'tone', sampleRate: 48_000, channelCount: 1, frameCount: 48_000 });
	const clip = createAudioClip({ id: 'clip', title: 'Cut recording', sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000 });
	const project = createFramescaperProject(PROFILE, { id: 'p3-new-track-sequences', sources: [source], clips: [clip],
		tracks: ['main', 'cut'].map(id => createAudioTrack({ id: `${id}-audio`, name: id, clipIds: id === 'cut' ? ['clip'] : [] })),
		sequences: ['main', 'cut'].map(id => ({ id, trackIds: [`${id}-audio`] })), primarySequenceId: 'main',
	});
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `p3-lane-${crypto.randomUUID()}` });
	let blob;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
		blob = (await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Cut.fscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await waitForProjectActivation(editor);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
	await clipByName(editor, 'Cut recording').locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Edit', 'Duplicate');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	const rows = editor.locator('[data-track-row]');
	await expect(rows).toHaveCount(3);
	await expect(rows.nth(0)).toHaveAttribute('data-track-id', 'main-audio');
	await expect(rows.nth(1)).toHaveAttribute('data-track-id', 'cut-audio');
	await expect(rows.nth(2)).toHaveAttribute('data-track-id', /^track-/u);
	await expect(rows.nth(2).locator('.clip-display')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '1'); await expect(rows).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(rows.nth(2).locator('.clip-display')).toHaveCount(1);
});
