/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const anchor of ['musical', 'sample']) test(`Project Bin shows the resolved ${anchor} recording duration after moving it from the timeline`, async ({ page }) => {
	const source = createAudioSource({ id: 'tone', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: `bin-${anchor}-duration`, sources: [source],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['music'] })], clips: [createAudioClip({ id: 'music', title: 'Musical source',
			sourceId: source.id, sourceDurationFrames: 48_000, anchor, ...(anchor === 'musical'
				? { musicalStartBeat: 0, musicalExtent: 'beat', musicalDurationBeats: 2 }
				: { timelineStartFrame: 0, durationFrames: 48_000 }) })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: project.id }); let blob;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
		blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Musical.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await waitForProjectActivation(editor);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
	await editor.locator('[data-clip-id="music"] .clip-header').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	if (!await editor.locator('[data-workspace-panel="project-bin"]').isVisible()) await chooseNestedCommandAction(page, editor, 'Window', ['Project bin']);
	const card = editor.locator('[data-project-bin-item="music"]'); await expect(card).toBeVisible();
	await expect(card.locator('.kw-audio-editor__project-bin-meta > span').first()).toHaveText('0:01.0');
});
