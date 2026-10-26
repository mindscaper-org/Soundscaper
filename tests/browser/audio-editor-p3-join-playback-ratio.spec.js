/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, disableNativeSavePicker, getMenuItem, openNestedCommandMenu, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const unequal of [false, true]) test(`Join preserves adjacent musical recordings with ${unequal ? 'unequal' : 'equal'} source traversal`, async ({ page }) => {
	test.setTimeout(90_000);
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 96_000, channelCount: 1 });
	const clips = [0, 1].map(index => createAudioClip({ id: `part-${index}`, title: `Part ${index + 1}`, sourceId: source.id,
		anchor: 'musical', musicalStartBeat: index * 2, musicalDurationBeats: unequal && index === 1 ? 1 : 2, musicalExtent: 'beat',
		sourceStartFrame: index * 48_000, sourceDurationFrames: 48_000 }));
	const project = createSoundscaperProject({ id: `join-ratio-${unequal}`, sources: [source], clips,
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: clips.map(clip => clip.id) })],
		selection: { startFrame: 0, endFrame: 0, trackIds: ['voice'], clipIds: clips.map(clip => clip.id) } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let start = 0; start < source.frameCount; start += 65_536) await writer.write([Float32Array.from({ length: Math.min(65_536, source.frameCount - start) }, (_, offset) => start + offset < 48_000 ? .125 : .375)]);
		await writer.commit(); const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Musical.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await preferences.getByRole('checkbox', { name: 'Apply 2 ms fades to new clips', exact: true }).uncheck();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'read-only');
	const before = await exportSamples(page, editor); expect(before).toHaveLength(unequal ? 72_000 : 96_000);
	await clipByName(editor, 'Part 1').press('Enter');
	await clipByName(editor, 'Part 2').press('Shift+Enter');
	await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(2);
	const menu = await openNestedCommandMenu(page, editor, 'Edit', ['Audio clips']);
	const join = getMenuItem(menu, 'Join'); await expect(join).toBeVisible();
	const enabled = await join.isEnabled();
	if (enabled) await join.press('Enter'); else await page.keyboard.press('Escape');
	const after = await exportSamples(page, editor); expect(after).toHaveLength(before.length);
	expect(Math.max(...after.map((sample, index) => Math.abs(sample - before[index])))).toBeLessThan(.00001);
	expect(enabled).toBe(!unequal);
	await expect(editor.locator('[data-clip-id]')).toHaveCount(unequal ? 2 : 1);
	if (!unequal) {
		await chooseCommandAction(page, editor, 'Edit', 'Undo'); await expect(editor.locator('[data-clip-id]')).toHaveCount(2);
		await chooseCommandAction(page, editor, 'Edit', 'Redo'); await expect(editor.locator('[data-clip-id]')).toHaveCount(1);
	}
});
