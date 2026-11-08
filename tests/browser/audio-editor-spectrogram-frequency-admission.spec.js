/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseNestedCommandAction, commitInput, waitForProjectActivation,
} from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

test('low-rate spectrogram preferences reject a frequency draft without displaying it as saved', async ({ page }) => {
	const { project, file } = await lowRateProjectFile();
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await waitForProjectActivation(editor);
	await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'No tracks']);
	let dialog = await openPreferences(page, editor);
	await commitInput(dialog.getByLabel('Minimum frequency (Hz)', { exact: true }), '3000');
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	dialog = await openPreferences(page, editor);
	const minimum = dialog.getByLabel('Minimum frequency (Hz)', { exact: true });
	await expect(minimum).toHaveValue('3000');
	await commitInput(minimum, '5000');
	await expect(minimum).toHaveValue('3000');
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	dialog = await openPreferences(page, editor);
	await expect(dialog.getByLabel('Minimum frequency (Hz)', { exact: true })).toHaveValue('3000');
});

test('higher-rate spectrogram defaults survive a refused low-rate maximum and allow an explicit repair', async ({ page }) => {
	const { project, file } = await lowRateProjectFile();
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'No tracks']);
	let dialog = await openPreferences(page, editor);
	await commitInput(dialog.getByLabel('Minimum frequency (Hz)', { exact: true }), '5000');
	await commitInput(dialog.getByLabel('Maximum frequency (Hz)', { exact: true }), '8000');
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await waitForProjectActivation(editor);
	await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'No tracks']);
	dialog = await openPreferences(page, editor);
	const minimum = dialog.getByLabel('Minimum frequency (Hz)', { exact: true });
	const maximum = dialog.getByLabel('Maximum frequency (Hz)', { exact: true });
	await expect(minimum).toHaveValue('5000');
	await expect(maximum).toHaveValue('8000');
	await commitInput(maximum, '4000');
	await expect(maximum).toHaveValue('8000');
	await commitInput(minimum, '3000');
	await commitInput(maximum, '4000');
	await expect(minimum).toHaveValue('3000');
	await expect(maximum).toHaveValue('4000');
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	dialog = await openPreferences(page, editor);
	await expect(dialog.getByLabel('Minimum frequency (Hz)', { exact: true })).toHaveValue('3000');
	await expect(dialog.getByLabel('Maximum frequency (Hz)', { exact: true })).toHaveValue('4000');
});

async function openPreferences(page, editor) {
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await dialog.getByRole('tab', { name: /Track display$/u }).click();
	await expect(dialog.locator('[data-spectrogram-settings]')).toHaveAttribute('data-spectrogram-target', 'defaults');
	return dialog;
}

async function lowRateProjectFile() {
	const source = createAudioSource({ id: 'source', frameCount: 8000, sampleRate: 8000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, title: 'Low rate',
		durationFrames: 8000, sourceDurationFrames: 8000 });
	const project = createSoundscaperProject({ id: 'spectrogram-low-rate', sampleRate: 8000,
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', name: 'Low rate', clipIds: [clip.id] }, 8000)] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([Float32Array.from({ length: 8000 }, (_, i) => .1 * Math.sin(i * 2 * Math.PI * 440 / 8000))]);
		await writer.commit();
		const archive = await exportScapeProject(project, store);
		return { project, file: { name: 'Low rate.sscape', mimeType: 'application/zip',
			buffer: Buffer.from(await archive.blob.arrayBuffer()) } };
	} finally { await store.close(); }
}
