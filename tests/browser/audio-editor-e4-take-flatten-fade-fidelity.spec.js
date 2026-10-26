/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const microfades of [true, false]) test(`Flatten comp preserves printed endpoints with new-clip fades ${microfades}`, async ({ page }) => {
	const source = createAudioSource({ id: 'recording', sampleRate: 48_000, frameCount: 12_000, channelCount: 2 });
	const project = createSoundscaperProject({ id: `take-fades-${microfades}`, sources: [source],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [] })],
		sequences: [{ id: 'main', trackIds: ['voice'] }], primarySequenceId: 'main',
		takeGroups: [{ id: 'comp', sequenceId: 'main', trackId: 'voice', startSample: 0, endSample: 12_000,
			laneOrder: ['lane'], lanes: [{ id: 'lane' }], takes: [{ id: 'take', laneId: 'lane', sourceId: source.id, startSample: 0, endSample: 12_000, sourceStartSample: 0 }],
			compRegions: [{ id: 'region', takeId: 'take', startSample: 0, endSample: 12_000 }] }],
	});
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let archive;
	try {
		const pcm = Float32Array.from({ length: 12_000 }, (_, frame) => .25 * Math.sin(2 * Math.PI * 1000 * frame / 48_000));
		const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write([pcm, pcm]); await writer.commit();
		archive = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Comp.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	if (!microfades) {
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Editing$/u }).click();
		await preferences.getByRole('checkbox', { name: 'Apply 2 ms fades to new clips' }).uncheck();
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	}
	const before = Float32Array.from({ length: 12_000 }, (_, frame) => .25 * Math.sin(2 * Math.PI * 1000 * frame / 48_000));
	await chooseTrackMenuAction(page, editor, editor.locator('[data-track-row]').first(), 'Take lanes and comps');
	const dialog = page.getByRole('dialog', { name: 'Take lanes and comps', exact: true });
	await dialog.getByRole('button', { name: 'Flatten comp', exact: true }).click();
	await expect(dialog.locator('[data-take-comp-empty]')).toBeVisible();
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	const after = await exportSamples(page, editor); expect(after).toHaveLength(before.length);
	const error = after.reduce((maximum, sample, frame) => Math.max(maximum, Math.abs(sample - before[frame])), 0);
	console.log('flatten endpoint comparison', { microfades, error }); expect(error).toBeLessThan(.0001);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await chooseTrackMenuAction(page, editor, editor.locator('[data-track-row]').first(), 'Take lanes and comps');
	await expect(dialog.locator('[data-take-comp-group]')).toBeVisible();
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	const redone = await exportSamples(page, editor);
	expect(redone.reduce((maximum, sample, frame) => Math.max(maximum, Math.abs(sample - after[frame])), 0)).toBeLessThan(.0001);
});
