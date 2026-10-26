/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';

test('File Export Audacity reads a long stored surround recording', async ({ page }) => {
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
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Surround.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await expect(editor).not.toHaveAttribute('data-project-activation-pending', 'true');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'import');
	const downloading = page.waitForEvent('download', { timeout: 90_000 });
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export AUP3']);
	const download = await downloading;
	await expect(editor.locator('[data-status]')).toContainText('exported');
	expect(download.suggestedFilename()).toMatch(/\.aup3$/u);
	const bytes = await downloadBytes(download);
	expect(new TextDecoder().decode(bytes.subarray(0, 16))).toBe('SQLite format 3\0');
});
