/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipField, closeClipProperties, collectClientErrors, commitInput, disableNativeSavePicker, openClipProperties, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('Clip Properties Speed preserves the audible gain after envelope points merge', async ({ page }) => {
	const source = createAudioSource({ id: 'recording', sampleRate: 48000, frameCount: 48000, channelCount: 1 });
	const project = createSoundscaperProject({ id: 'speed-envelope', sources: [source],
		clips: [createAudioClip({ id: 'clip', title: 'Envelope', sourceId: source.id, durationFrames: 48000, sourceDurationFrames: 48000,
			linkPitchAndTempo: true, envelope: [{ frame: 0, value: .2 }, { frame: 10000, value: .1 }, { frame: 10001, value: .9 }, { frame: 48000, value: .9 }] })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write([new Float32Array(48000).fill(.25)]); await writer.commit();
		const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Envelope.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	const errors = collectClientErrors(page); await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file); await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const properties = await openClipProperties(page, editor, editor.locator('[data-clip-id="clip"]').first());
	await commitInput(clipField(properties, 'speedRatio'), '1000'); await expect(clipField(properties, 'speedRatio')).toHaveValue('1000');
	await closeClipProperties(properties);
	const output = await exportSamples(page, editor); expect(output).toHaveLength(4800);
	const expected = .25 * .9 * Math.SQRT1_2;
	const error = Math.max(...output.slice(1500, 4000).map(sample => Math.abs(sample - expected)));
	expect(error).toBeLessThan(.0001);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	const restored = await openClipProperties(page, editor, editor.locator('[data-clip-id="clip"]').first());
	await expect(clipField(restored, 'speedRatio')).toHaveValue('100'); await closeClipProperties(restored);
	expect(errors).toEqual([]);
});
