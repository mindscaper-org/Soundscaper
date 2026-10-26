/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const grouped of [true, false]) test(`Remove a Bin recording keeps different grouped media: ${String(grouped)}`, async ({ page }) => {
	const sources = ['voice', 'music'].map(id => createAudioSource({ id, name: id, sampleRate: 48_000, channelCount: 1, frameCount: 48_000 }));
	const clips = sources.map(source => createAudioClip({ id: source.id, title: source.name, sourceId: source.id,
		durationFrames: 48_000, sourceDurationFrames: 48_000, groupId: grouped ? 'group' : null }));
	const project = createSoundscaperProject({ id: `p3-remove-source-${String(grouped)}`, sources, clips,
		tracks: clips.map(clip => createAudioTrack({ id: `track-${clip.id}`, name: clip.title, clipIds: [clip.id] })),
		projectBin: { clips: [createAudioClip({ ...clips[0], title: 'Reusable voice', id: 'bin-voice', binItemId: 'voice-item', groupId: null })] } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let file;
	try {
		for (const source of sources) {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			await writer.write([new Float32Array(48_000).fill(source.id === 'music' ? .5 : .25)]); await writer.commit();
		}
		const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Grouped.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	await disableNativeSavePicker(page); let editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const card = editor.getByRole('listitem', { name: 'Project bin: Reusable voice', exact: true });
	await card.locator('.kw-audio-editor__project-bin-overflow').click();
	await page.getByRole('menuitem', { name: 'Remove from project', exact: true }).click();
	const confirmation = page.getByRole('alertdialog', { name: 'Remove from project', exact: true });
	await expect(confirmation).toContainText('all 1 instances');
	await confirmation.getByRole('button', { name: 'Remove from project', exact: true }).click();
	await expect(card).toBeHidden(); await expect(clipByName(editor, 'voice')).toHaveCount(0);
	await expect(clipByName(editor, 'music')).toHaveCount(1);
	const samples = await exportSamples(page, editor);
	expect(samples.length).toBe(48_000); expect(samples[24_000]).toBeCloseTo(.5 * Math.SQRT1_2, 5);
	await chooseCommandAction(page, editor, 'Edit', 'Undo'); await expect(clipByName(editor, 'voice')).toHaveCount(1);
	await expect(clipByName(editor, 'music')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Redo'); await expect(clipByName(editor, 'voice')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'File', 'Save project');
	await page.reload(); editor = page.locator('#kw-audio-editor-design-system'); await waitForProjectActivation(editor);
	await expect(clipByName(editor, 'music')).toHaveCount(1); await expect(clipByName(editor, 'voice')).toHaveCount(0);
});
