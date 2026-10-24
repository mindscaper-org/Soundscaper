/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, commitInput, disableNativeSavePicker, openSelectionEffectDialog, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('a destructive selection effect consumes the already rendered warp map', async ({ page }) => {
	const errors = collectClientErrors(page);
	const source = createAudioSource({ id: 'recording', sampleRate: 48000, frameCount: 48000, channelCount: 1 });
	const project = createSoundscaperProject({ id: 'rendered-warp', sources: [source],
		clips: [createAudioClip({ id: 'clip', title: 'Warp', sourceId: source.id, durationFrames: 48000, sourceDurationFrames: 48000,
			warpMap: { feature: 'audio-warp', points: [{ outer: 0, source: 0, mode: 'forward' }, { outer: 12000, source: 24000, mode: 'forward' }, { outer: 48000, source: 48000, mode: 'forward' }] } })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([Float32Array.from({ length: 48000 }, (_, frame) => frame < 24000 ? .1 : .4)]); await writer.commit();
		const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Warp.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file); await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const before = await exportSamples(page, editor);
	await editor.locator('[data-clip-id="clip"] .clip-header').click(); const dialog = await openSelectionEffectDialog(page, editor);
	await commitInput(dialog.locator('[data-effect-param="volumeDb"] input'), '-6');
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click(); await expect(dialog).toBeHidden({ timeout: 20_000 });
	const after = await exportSamples(page, editor); expect(after).toHaveLength(before.length);
	const gain = 10 ** (-6 / 20);
	expect(Math.max(...after.map((sample, index) => Math.abs(sample - before[index] * gain)))).toBeLessThan(.0001);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	const undone = await exportSamples(page, editor); expect(undone).toHaveLength(before.length);
	expect(Math.max(...undone.map((sample, index) => Math.abs(sample - before[index])))).toBeLessThan(.0001);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	const redone = await exportSamples(page, editor); expect(redone).toHaveLength(after.length);
	expect(Math.max(...redone.map((sample, index) => Math.abs(sample - after[index])))).toBeLessThan(.0001);
	expect(errors).toEqual([]);
});
