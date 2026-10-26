/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const anchor of ['sample', 'musical']) test(`Play options admit a selected ${anchor} recording without a drawn time range`, async ({ page }) => {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 48_000 });
	const clip = createAudioClip({ id: 'clip', title: 'Voice recording', sourceId: source.id, sourceStartFrame: 0, sourceDurationFrames: 48_000,
		...(anchor === 'sample' ? { timelineStartFrame: 24_000, durationFrames: 48_000 }
			: { anchor: 'musical', musicalStartBeat: 1, musicalExtent: 'beat', musicalDurationBeats: 2 }) });
	const project = createSoundscaperProject({ id: `p3-transport-${anchor}`, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [clip.id] })],
		selection: { startFrame: 0, endFrame: 0, trackIds: ['voice'], clipIds: [clip.id] } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
		const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Voice.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	await expect(clipByName(editor, clip.title).locator('.clip-display[data-selected="true"]')).toHaveCount(1);
	await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(0);
	await editor.getByRole('button', { name: 'Play options', exact: true }).click();
	const menu = page.getByRole('menu', { name: 'Play options', exact: true });
	await expect(menu.getByRole('menuitem', { name: /^Play selection(?:\s|$)/u })).toBeEnabled();
	await expect(menu.getByRole('menuitem', { name: 'Cut preview', exact: true })).toBeEnabled();
	await page.keyboard.press('Escape');
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await editor.getByRole('button', { name: 'Play options', exact: true }).click();
	await expect(menu.getByRole('menuitem', { name: /^Play selection(?:\s|$)/u })).toBeDisabled();
	await expect(menu.getByRole('menuitem', { name: 'Cut preview', exact: true })).toBeDisabled();
});
