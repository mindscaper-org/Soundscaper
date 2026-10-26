/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const collision of [false, true]) test(`Move to Bin preserves an existing item when its ID ${collision ? 'matches' : 'differs from'} the timeline clip`, async ({ page }) => {
	test.setTimeout(90_000);
	const source = createAudioSource({ id: 'sound', name: 'Sound.wav', sampleRate: 48_000, channelCount: 1, frameCount: 48_000 });
	const clip = createAudioClip({ id: 'take', title: 'Timeline recording', sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000 });
	const project = createSoundscaperProject({ id: `bin-items-${String(collision)}`, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice', clipIds: [clip.id] })],
		projectBin: { clips: [createAudioClip({ ...clip, id: 'existing', title: 'Existing recording', binItemId: collision ? 'take' : 'old-item' })] } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
		const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Items.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	let editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
	const existing = editor.getByRole('listitem', { name: 'Project bin: Existing recording', exact: true });
	await expect(existing).toBeVisible();
	const originalItem = await existing.getAttribute('data-project-bin-item');
	await clipByName(editor, 'Timeline recording').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const moved = editor.getByRole('listitem', { name: 'Project bin: Timeline recording', exact: true });
	await expect(moved).toBeVisible(); await expect(existing).toBeVisible();
	await expect(clipByName(editor, 'Timeline recording')).toHaveCount(0);
	expect(await moved.getAttribute('data-project-bin-item')).not.toBe(originalItem);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clipByName(editor, 'Timeline recording')).toHaveCount(1); await expect(moved).toHaveCount(0);
	await expect(existing).toHaveAttribute('data-project-bin-item', originalItem);
	await chooseCommandAction(page, editor, 'Edit', 'Redo'); await expect(moved).toBeVisible(); await expect(existing).toBeVisible();
	await chooseCommandAction(page, editor, 'File', 'Save project');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload(); editor = page.locator('#kw-audio-editor-design-system'); await waitForProjectActivation(editor);
	await expect(editor.getByRole('listitem', { name: 'Project bin: Existing recording', exact: true })).toBeVisible();
	await expect(editor.getByRole('listitem', { name: 'Project bin: Timeline recording', exact: true })).toBeVisible();
});
