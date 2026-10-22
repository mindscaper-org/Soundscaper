/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, clipByName } from './audio-editor-test-helpers.js';

test('a long repeated recording retains its spectrogram across a repeat boundary', async ({ page }) => {
	const recording = createWavFixture({ name: 'loop-spectrum.wav', duration: 10, frequency: 440, channelCount: 1 });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [recording]);
	await editor.getByRole('button', { name: 'Fit project', exact: true }).click();
	const clip = clipByName(editor, recording.name);
	await clip.locator('.clip-header').click();
	const loop = clip.getByRole('slider', { name: 'Looped clip length', exact: true });
	const length = Number(await loop.getAttribute('aria-valuenow'));
	await loop.press('ArrowRight');
	await editor.getByRole('button', { name: 'Fit project', exact: true }).click();
	await clip.locator('.clip-header').click();
	await expect(loop).toHaveAttribute('aria-valuenow', String(length * 2));
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await expect(clip.locator('xpath=ancestor::*[@data-track-row]')).toHaveAttribute('data-display-mode', 'spectrogram');
	const canvas = clip.locator('canvas.clip-body__waveform').first();
	await expect(canvas).toHaveAttribute('data-spectrogram-renderer', 'pffft-wasm');
	await expect.poll(() => canvas.evaluate(element => element.__kwSpectrogramColumnsPlan?.channels?.[0]?.length ?? 0)).toBeGreaterThan(10);
	const peak = await canvas.evaluate(element => {
		const columns = element.__kwSpectrogramColumnsPlan.channels[0];
		return Math.max(...columns[Math.floor(columns.length / 2)]);
	});
	expect(peak).toBeGreaterThan(0.001);
});
