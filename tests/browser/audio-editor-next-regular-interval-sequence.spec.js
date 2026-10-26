/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

test('regular annotation defaults do not borrow the duration of a different sequence', async ({ page }) => {
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	let archive;
	try {
		const source = createAudioSource({ id: 'pcm', frameCount: 480_000, sampleRate: 48_000, channelCount: 1 });
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let offset = 0; offset < source.frameCount; offset += source.chunkFrames) await writer.write([new Float32Array(Math.min(source.chunkFrames, source.frameCount - offset))]);
		await writer.commit();
		const project = createSoundscaperProject({ id: 'interval-sequences', sampleRate: 48_000, sources: [source],
			clips: [createAudioClip({ id: 'own', sourceId: 'pcm', sourceDurationFrames: 48_000, durationFrames: 48_000 }),
				createAudioClip({ id: 'foreign', sourceId: 'pcm', sourceDurationFrames: 480_000, durationFrames: 480_000 })],
			tracks: [createAudioTrack({ id: 'one', clipIds: ['own'] }), createAudioTrack({ id: 'two', clipIds: ['foreign'] })],
			sequences: [{ id: 'main', trackIds: ['one'] }, { id: 'other', trackIds: ['two'] }], primarySequenceId: 'main',
		});
		archive = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Sequences.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'interval-sequences');
	await chooseCommandAction(page, editor, 'Tools', 'Regular interval labels');
	const dialog = page.getByRole('dialog', { name: 'Regular interval labels', exact: true });
	await expect(dialog.getByRole('group', { name: 'End frame', exact: true }).locator('.timecode__display')).toHaveText('00h00m01.000s');
	await dialog.getByRole('button', { name: 'Create annotations', exact: true }).click();
	await expect(dialog).toBeHidden();
	await chooseNestedCommandAction(page, editor, 'Window', ['Markers']);
	const markers = editor.getByRole('list', { name: 'Marker and region list', exact: true });
	await expect(markers.getByRole('listitem')).toHaveCount(1);
	await expect(markers).toContainText('Cue 1');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(markers).toHaveCount(0);
});
