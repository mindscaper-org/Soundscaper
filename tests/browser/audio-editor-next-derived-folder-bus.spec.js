/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const operation of ['split', 'merge']) test(`Stereo ${operation} retains the surviving folder bus in actual WAV output`, async ({ page }) => {
	const source = createAudioSource({ id: 'tone', frameCount: 48_000, sampleRate: 48_000, channelCount: operation === 'split' ? 2 : 1 });
	const ids = operation === 'split' ? ['voice'] : ['voice', 'partner'];
	const base = createSoundscaperProject({ id: `folder-bus-${operation}`, sources: [source],
		tracks: ids.map(id => createAudioTrack({ id, clipIds: [`${id}-clip`] })),
		clips: ids.map(id => createAudioClip({ id: `${id}-clip`, sourceId: source.id, title: id, durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })),
		trackFolders: [{ id: 'mix', name: 'Mix' }], sequences: [{ id: 'main', trackNodes: [
			{ id: 'mix', kind: 'folder', parentFolderId: null }, ...ids.map(id => ({ id, kind: 'track', parentFolderId: 'mix' })),
		] }], primarySequenceId: 'main' });
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, groups: base.mixer.groups.map(bus => ({ ...bus, gain: .5 })) } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `next-project-fixture-${crypto.randomUUID()}` }); let blob;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write(Array.from({ length: source.channelCount }, () => new Float32Array(source.frameCount).fill(.25))); await writer.commit();
		blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Mix.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
	const before = await exportSamples(page, editor);
	const row = editor.locator('[data-track-row][data-track-id="voice"]');
	await chooseTrackMenuAction(page, editor, row, ['Track channels', operation === 'split' ? 'Split stereo to left/right mono' : 'Make stereo track']);
	await expect(editor.locator('[data-clip-id]')).toHaveCount(operation === 'split' ? 2 : 1);
	const after = await exportSamples(page, editor); expect(after[1_000]).toBeCloseTo(.125, 5);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const undone = await exportSamples(page, editor); expect(undone[1_000]).toBeCloseTo(before[1_000], 5);
});
