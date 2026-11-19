/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseFileAction, chooseNestedCommandAction, clipByName,
	disableNativeSavePicker, downloadBytes, importFiles, waitForProjectActivation,
} from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { exportSamples } from './helpers/round2-audio-export.js';

function rms(samples, start, end) {
	let sum = 0;
	for (let index = Math.round(start * 48_000); index < Math.round(end * 48_000); index += 1) sum += samples[index] ** 2;
	return Math.sqrt(sum / Math.round((end - start) * 48_000));
}

test('Audacity project round trips preserve audible repeats and authored nonlinear warp timing', async ({ page }) => {
	test.setTimeout(180_000);
	const editor = await test.step('audible repeats survive physical AUP4 export and File Open', async () => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		const recording = createWavFixture({ name: 'looped-pause.wav', frequency: 1000, duration: 0.8, channelCount: 1 });
		recording.buffer.fill(0, 44 + 9_600 * 2, 44 + 14_400 * 2);
		await importFiles(editor, [recording]);
		const clip = clipByName(editor, recording.name);
		await clip.locator('.clip-header').click();
		await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
		await expect(clip).toHaveAccessibleName(/1\.6 seconds long$/u);
		const before = await exportSamples(page, editor);
		expect(rms(before, 1.05, 1.08)).toBeLessThan(0.0001);
		expect(rms(before, 0.9, 0.95)).toBeGreaterThan(0.1);
		const downloading = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export AUP4']);
		const download = await downloading;
		const bytes = await downloadBytes(download);
		const choosing = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await choosing).setFiles({ name: download.suggestedFilename(), mimeType: 'application/x-audacity-project', buffer: Buffer.from(bytes) });
		await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
		const after = await exportSamples(page, editor);
		expect(after.length).toBe(before.length);
		expect(rms(after, 1.05, 1.08)).toBeLessThan(0.0001);
		expect(rms(after, 0.9, 0.95)).toBeGreaterThan(0.1);
		return editor;
	}, { timeout: 90_000 });
	await test.step('a fresh nonlinear warp survives physical AUP4 export and File Open', async () => {
		const previousProjectId = await editor.getAttribute('data-project-id');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await expect(editor).not.toHaveAttribute('data-project-id', previousProjectId);
		await waitForProjectActivation(editor);
		await expect(editor).toHaveAttribute('data-editor-ready', 'true');
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		const projectId = await editor.getAttribute('data-project-id');
		await expect.poll(async () => (await persistedProject(page, projectId))?.sources.length).toBe(0);
		const recording = createWavFixture({ name: 'warped-production-pause.wav', frequency: 1000, duration: 1, channelCount: 1 });
		// A normal recording with a quarter-second pause, retaining its PCM WAV header.
		recording.buffer.fill(0, 44 + 12_000 * 2, 44 + 24_000 * 2);
		await importFiles(editor, [recording]);
		await clipByName(editor, recording.name).locator('.clip-header').click();
		await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
		const warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
		await warp.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
		await warp.getByLabel('Outer position', { exact: true }).fill('24000');
		await warp.getByLabel('Source sample', { exact: true }).fill('36000');
		await warp.getByRole('button', { name: 'Add marker', exact: true }).click();
		await expect(warp.getByLabel('Marker 1 source sample', { exact: true })).toHaveValue('36000/1');
		await warp.getByRole('button', { name: 'Close', exact: true }).click();
		const before = await exportSamples(page, editor);
		expect(rms(before, 0.2, 0.24)).toBeLessThan(0.001);
		expect(rms(before, 0.1, 0.14)).toBeGreaterThan(0.1);
		const downloading = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export AUP4']);
		const download = await downloading;
		const bytes = await downloadBytes(download);
		const choosing = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await choosing).setFiles({ name: download.suggestedFilename(), mimeType: 'application/x-audacity-project', buffer: Buffer.from(bytes) });
		await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', { timeout: 30_000 });
		const after = await exportSamples(page, editor);
		expect(after.length).toBe(before.length);
		expect(rms(after, 0.2, 0.24)).toBeLessThan(0.001);
		expect(rms(after, 0.1, 0.14)).toBeGreaterThan(0.1);
	}, { timeout: 90_000 });
});
