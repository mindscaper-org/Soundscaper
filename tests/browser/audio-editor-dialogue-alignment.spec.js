/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, collectClientErrors, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperEphemeralProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { dialogueFixture } from '../helpers/dialogue-alignment-fixture.ts';
import { createEffect } from '../../src/common/editor/effects.js';
import { exportSamples } from './helpers/round2-audio-export.js';

async function dialogueArchive(rack = false) {
	const rate = 48000, pcm = [dialogueFixture([.45, .6, .35, .5], rate), dialogueFixture([.6, .4, .55, .35], rate)];
	const sources = ['Location dialogue', 'Studio replacement'].map((name, index) => createAudioSource({ id: `source-${index}`, storageKey: `source-${index}`,
		name, sampleRate: rate, frameCount: pcm[index].length, channelCount: 1 }));
	const clips = sources.map((source, index) => createAudioClip({ id: `clip-${index}`, title: source.name, sourceId: source.id,
		timelineStartFrame: rate * (index ? 5 : 1), durationFrames: pcm[index].length, sourceStartFrame: 0, sourceDurationFrames: pcm[index].length,
		effects: rack && index ? [createEffect('delay', { params: { time: .1, feedback: 0, mix: 1 } })] : [] }));
	const tracks = clips.map((clip, index) => createAudioTrack({ id: `track-${index}`, name: sources[index].name, clipIds: [clip.id] }));
	const project = createSoundscaperProject({ id: 'dialogue-alignment-review', sampleRate: rate, sources, clips, tracks });
	const store = createSoundscaperEphemeralProjectStore();
	try {
		for (let index = 0; index < sources.length; index++) {
			const writer = await store.beginSourceWrite(sources[index].storageKey, sources[index]);
			for (let start = 0; start < pcm[index].length; start += 65536) await writer.write([pcm[index].subarray(start, start + 65536)]);
			await writer.commit();
		}
		const archive = await exportScapeProject(project, store);
		return { project, buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
}

test('Create aligned copy retains the audible replacement clip delay', async ({ page }) => {
	await disableNativeSavePicker(page);
	const { project, buffer } = await dialogueArchive(true), editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'ADR rack.sscape', mimeType: 'application/zip', buffer });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Align dialogue']);
	const dialog = page.getByRole('dialog', { name: 'Align dialogue', exact: true });
	await dialog.getByRole('combobox', { name: 'Reference clip', exact: true }).selectOption('clip-0');
	await dialog.getByRole('combobox', { name: 'Replacement clip', exact: true }).selectOption('clip-1');
	await dialog.getByRole('button', { name: 'Analyze and align', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Create aligned copy', exact: true })).toBeEnabled();
	await dialog.getByRole('button', { name: 'Create aligned copy', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect.poll(async () => (await persistedProject(page, project.id)).clips.length).toBe(3);
	await editor.locator('[data-track-row]').last().getByRole('button', { name: 'Solo', exact: true }).click();
	const samples = await exportSamples(page, editor, { includeTail: true });
	expect(samples.slice(48480, 51360).every(sample => Math.abs(sample) < .000001)).toBe(true);
	expect(samples.slice(57600, 67200).some(sample => Math.abs(sample) > .01)).toBe(true);
});

test('Edit > Audio clips aligns and previews dialogue, publishes one undoable copy, and reopens it', async ({ page }) => {
	const errors = collectClientErrors(page), { project, buffer } = await dialogueArchive();
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'ADR.sscape', mimeType: 'application/zip', buffer });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	const clip = editor.locator('[data-clip-id="clip-0"]');
	await clip.locator('.clip-header').click({ button: 'right' });
	await expect(page.locator('.audio-editor-clip-context-menu')).toBeVisible();
	await expect(page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: 'Align dialogue', exact: true })).toHaveCount(0);
	await page.keyboard.press('Escape');
	const open = async () => {
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Align dialogue']);
		return page.getByRole('dialog', { name: 'Align dialogue', exact: true });
	};
	let dialog = await open();
	await expect(dialog.getByRole('button', { name: 'Create aligned copy', exact: true })).toBeDisabled();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	expect((await persistedProject(page, project.id)).sources).toHaveLength(2);
	dialog = await open();
	await dialog.getByRole('combobox', { name: 'Reference clip', exact: true }).selectOption('clip-0');
	await dialog.getByRole('combobox', { name: 'Replacement clip', exact: true }).selectOption('clip-1');
	await dialog.getByRole('button', { name: 'Analyze and align', exact: true }).click();
	await expect(dialog.getByText('Alignment is ready. Listen to the result before creating the copy.')).toBeVisible();
	expect((await persistedProject(page, project.id)).clips).toHaveLength(2);
	await dialog.getByRole('button', { name: 'Play aligned', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Stop preview', exact: true })).toBeEnabled();
	await expect(dialog.getByRole('alert')).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Stop preview', exact: true }).click();
	await dialog.getByRole('spinbutton', { name: 'Alignment strength (%)', exact: true }).fill('75');
	await expect(dialog.getByRole('button', { name: 'Create aligned copy', exact: true })).toBeDisabled();
	await dialog.getByRole('button', { name: 'Analyze and align', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Create aligned copy', exact: true })).toBeEnabled();
	await dialog.getByRole('button', { name: 'Create aligned copy', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect.poll(async () => (await persistedProject(page, project.id)).clips.length).toBe(3);
	const aligned = await persistedProject(page, project.id);
	expect(aligned.sources).toHaveLength(3); expect(aligned.tracks).toHaveLength(3);
	expect(aligned.clips.slice(0, 2)).toEqual(project.clips);
	expect(aligned.tracks.slice(0, 2)).toEqual(project.tracks);
	expect(aligned.clips[2].timelineStartFrame).toBe(48000);
	expect(aligned.clips[2].durationFrames).toBe(project.clips[0].durationFrames);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect.poll(async () => (await persistedProject(page, project.id)).clips.length).toBe(2);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect.poll(async () => (await persistedProject(page, project.id)).clips.length).toBe(3);
	await page.reload();
	await expect(editor).toHaveAttribute('data-editor-ready', 'true');
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	expect((await persistedProject(page, project.id)).clips).toEqual(aligned.clips);
	expect(errors).toEqual([]);
});
