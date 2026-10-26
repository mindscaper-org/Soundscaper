/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { addClipGainPoint, persistedProject } from './helpers/complex-editing-workflows.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('Spectrogram follows a clip envelope that silences the exported recording', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'envelope.wav', duration: 2, frequency: 440, channelCount: 1 })]);
	const clip = editor.locator('[data-clip-id]').first();
	const point = (await addClipGainPoint(page, editor, clip, .5)).first();
	const projectId = await editor.getAttribute('data-project-id');
	await expect.poll(async () => (await persistedProject(page, projectId))?.clips[0]?.envelope?.length).toBe(1);
	const bounds = await point.boundingBox();
	const envelopeBounds = await clip.locator('.envelope-overlay').boundingBox();
	expect(bounds).not.toBeNull();
	expect(envelopeBounds).not.toBeNull();
	await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width / 2, envelopeBounds.y + envelopeBounds.height - 1, { steps: 4 });
	await page.mouse.up();
	await expect.poll(async () => (await persistedProject(page, projectId))?.clips[0]?.envelope?.some(item => item.value === 0)).toBe(true);
	await editor.getByRole('button', { name: 'Clip gain', exact: true }).click();
	const samples = await exportSamples(page, editor);
	const peak = values => values.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
	expect(samples).toHaveLength(96_000);
	expect(peak(samples.slice(1000, 10_000))).toBeGreaterThan(.2);
	const exportedLatePeak = peak(samples.slice(72_000, 80_000));
	expect(exportedLatePeak).toBeLessThan(.00001);
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	const canvas = clip.locator('canvas.clip-body__waveform').first();
	await expect(canvas).toHaveAttribute('data-spectrogram-renderer', 'pffft-wasm');
	await expect.poll(() => canvas.evaluate(element => element.__kwSpectrogramColumnsPlan?.channels?.[0]?.length ?? 0)).toBeGreaterThan(10);
	const spectralPeak = position => canvas.evaluate((element, fraction) => {
		const columns = element.__kwSpectrogramColumnsPlan.channels[0];
		return Math.max(...columns[Math.floor(columns.length * fraction)]);
	}, position);
	expect(await spectralPeak(.1)).toBeGreaterThan(.01);
	expect(await spectralPeak(.8)).toBeLessThan(Math.max(.00001, exportedLatePeak * 4));
});
