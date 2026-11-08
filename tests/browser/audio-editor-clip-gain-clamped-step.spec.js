/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, openClipProperties, waitForProjectActivation, disableNativeSavePicker, downloadBytes, chooseExportProjectFileAction, closeClipProperties } from './audio-editor-test-helpers.js';
import { openClipGainDialog } from './audio-editor-clip-settings-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { strFromU8, unzipSync } from 'fflate';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

test(`decrementing an already-minimum gain does not unmute a silent native clip`, async ({ page }) => {
	const gain = 0;
	await disableNativeSavePicker(page);
	const source = createAudioSource({ id: 'source', frameCount: 48_000, channelCount: 1, sampleRate: 48_000 });
	const clip = createAudioClip({ id: 'clip', title: 'Voice recording', sourceId: source.id, gain,
		durationFrames: 48_000, sourceDurationFrames: 48_000 });
	const project = createSoundscaperProject({ id: `p3-native-gain-${gain}`, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [clip.id] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(48_000).fill(.01)]); await writer.commit();
		const archive = await exportScapeProject(project, store);
		expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Voice.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const properties = await openClipProperties(page, editor, clipByName(editor, clip.title));
	const dialog = await openClipGainDialog(properties);
	const field = dialog.getByRole('textbox', { name: 'Clip gain (dB)', exact: true });
	await expect(field).toHaveValue('-60');
	await field.locator('..').getByRole('button', { name: 'Decrease value', exact: true }).click();
	await expect(field).toHaveValue('-60');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await closeClipProperties(properties);
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const saved = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	expect(saved.clips[0].gain).toBe(0);
});
