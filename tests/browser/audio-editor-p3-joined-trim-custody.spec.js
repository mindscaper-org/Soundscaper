/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const reversed of [true, false]) test(`Join retains independently trimmed source edges; reversed=${String(reversed)}`, async ({ page }) => {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 100_000, channelCount: 1 });
	const clips = [0, 1].map(index => {
		const start = reversed ? 50_000 - index * 10_000 : 40_000 + index * 10_000;
		return createAudioClip({ id: `clip-${index}`, title: `Part ${index + 1}`, sourceId: source.id,
			timelineStartFrame: index * 10_000, durationFrames: 10_000, sourceStartFrame: start, sourceDurationFrames: 10_000,
			trimStartFrames: start, trimEndFrames: source.frameCount - start - 10_000, reversed });
	});
	const project = createSoundscaperProject({ id: `p3-joined-trims-${reversed}`, sources: [source], clips,
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: clips.map(clip => clip.id) })],
		selection: { startFrame: 0, endFrame: 0, trackIds: ['voice'], clipIds: clips.map(clip => clip.id) } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let offset = 0; offset < source.frameCount; offset += 65_536) {
			const count = Math.min(65_536, source.frameCount - offset);
			await writer.write([Float32Array.from({ length: count }, (_, index) => Math.sin((offset + index) * .031) * .25)]);
		}
		await writer.commit(); const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Trimmed.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await preferences.getByRole('checkbox', { name: 'Apply 2 ms fades to new clips', exact: true }).uncheck();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const parts = editor.locator('[data-clip-id]'); await expect(parts).toHaveCount(2);
	const before = await exportSamples(page, editor);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Join']);
	await expect(parts).toHaveCount(1);
	const after = await exportSamples(page, editor); expect(after).toHaveLength(before.length);
	expect(after.every((sample, index) => Math.abs(sample - before[index]) < .00001)).toBe(true);
	await chooseCommandAction(page, editor, 'Edit', 'Undo'); await expect(parts).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Edit', 'Redo'); await expect(parts).toHaveCount(1);
});
