/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const trackId of ['voice', 'source-editor:original', 'source-editor:missing']) test(`native timeline ${trackId} Amplify reads the audible trimmed recording`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const source = createAudioSource({ id: 'original', sampleRate: 48_000, channelCount: 1, frameCount: 96_000 });
	const project = createSoundscaperProject({ id: `source-identity-${trackId}`, sampleRate: 48_000, masterChannels: 1, sources: [source],
		tracks: [createAudioTrack({ id: trackId, name: 'Trimmed voice', clipIds: ['clip'] })],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, sourceStartFrame: 48_000, sourceDurationFrames: 48_000, durationFrames: 48_000 })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: project.id });
	let archive;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		const pcm = new Float32Array(96_000).fill(.1); pcm.fill(.4, 48_000);
		await writer.write([pcm.slice(0, 65_536)]); await writer.write([pcm.slice(65_536)]); await writer.commit();
		archive = (await createSoundscaperScapeNativeRuntime().exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Trimmed voice.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const before = Math.max(...(await exportSamples(page, editor)).slice(4800, 43_200));
	expect(before).toBeGreaterThan(.1);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Amplify']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	const gain = dialog.locator('[data-effect-param="gainDb"]').getByRole('spinbutton');
	await expect.poll(async () => Number(await gain.inputValue())).toBeCloseTo(20 * Math.log10(1 / .4), 2);
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click(); await expect(dialog).toBeHidden();
	const output = await exportSamples(page, editor);
	expect(Math.max(...output.slice(4800, 43_200))).toBeCloseTo(before / .4, 3);
});
