/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';

// Multiline defaults retain controller/history/PCM/Scape custody coverage in
// audio-editor-adm-default-name-custody.test.ts; keep both metadata UI routes here.
for (const mode of ['programme', 'object']) {
	test(`ADM ${mode} defaults admit ordinary existing descriptive names`, async ({ page }) => {
		const name = 'Opening Room tone';
		const title = mode === 'programme' ? name : 'Ordinary programme';
		const trackName = mode === 'object' ? name : 'Dialogue';
		const source = createAudioSource({ id: 'source', storageKey: 'source', frameCount: 4800, sampleRate: 48000, channelCount: 1, name: 'Room.wav' });
		const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 });
		const track = createAudioTrack({ id: 'track', name: trackName, clipIds: [clip.id] });
		const project = createSoundscaperProject({ id: `adm-${mode}-false`, sampleRate: 48000, metadata: { title }, sources: [source], clips: [clip], tracks: [track],
			sequences: [{ id: 'main', trackIds: [track.id] }], primarySequenceId: 'main' });
		expect(project.metadata.title).toBe(title);
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
		let archive;
		try {
			const writer = await store.beginSourceWrite(source.storageKey, { name: source.name, mimeType: source.mimeType, sampleRate: source.sampleRate, channelCount: source.channelCount, chunkFrames: source.chunkFrames });
			await writer.write([new Float32Array(4800).fill(.2)]); await writer.commit();
			archive = (await createSoundscaperScapeNativeRuntime().exportScapeProject(project, store)).blob;
		} finally { await store.close(); }
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await editor.locator('[data-aup4-input]').setInputFiles({ name: 'ADM title.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		const panel = editor.locator('[data-workspace-panel="metadata"]');
		await expect(panel.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title);
		await panel.getByRole('tab', { name: 'ADM', exact: true }).click();
		await panel.getByRole('button', { name: 'Enable ADM', exact: true }).click();
		await expect(panel.locator('[data-adm-mode="authored"]')).toBeVisible();
		await expect(panel.locator('input[name="adm-programme-name"]')).toHaveValue(title.replaceAll('\n', ' '));
		if (mode === 'object') {
			await panel.getByRole('button', { name: 'Add object', exact: true }).click();
			await expect(panel.locator('.audio-editor-adm-object')).toHaveCount(1);
			await expect(panel.locator('input[name^="adm-object-name-"]')).toHaveValue(`${trackName.replaceAll('\n', ' ')} — channel 1`);
		}
		const downloading = page.waitForEvent('download');
		await chooseExportProjectFileAction(page, editor);
		const saved = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
		expect(saved.metadata.title).toBe(title);
		expect(saved.tracks[0].name).toBe(trackName);
		expect(saved.metadata.adm.programme.name).toBe(title.replaceAll('\n', ' '));
		if (mode === 'object') {
			expect(saved.metadata.adm.objects).toHaveLength(1);
			expect(saved.metadata.adm.objects[0]).toMatchObject({ name: `${trackName.replaceAll('\n', ' ')} — channel 1`, stripId: track.id, sourceChannel: 0 });
		}
	});
}
