/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, closeClipProperties, disableNativeSavePicker, importFiles, openClipProperties, openSourceMonitor } from './audio-editor-test-helpers.js';
import { chooseClipMediaSetting } from './audio-editor-clip-settings-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { calculateAudioSpectrum } from '../../src/common/editor/audio-spectrum.ts';

for (const variant of [
	{ mode: 'pitch' }, { mode: 'tempo' }, { mode: 'linked' }, { mode: 'neutral' },
	{ mode: 'pitch', loop: true }, { mode: 'pitch', source: true }, { mode: 'tempo', source: true },
]) test(`Spectrogram follows clip ${variant.mode} (loop ${String(!!variant.loop)}, Source Editor ${String(!!variant.source)})`, async ({ page }) => {
	const { mode } = variant;
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: `${mode}.wav`, duration: variant.loop ? 7 : 2, frequency: 1000, channelCount: 1 })]);
	const clip = editor.locator('[data-clip-id]').first();
	const properties = await openClipProperties(page, editor, clip, { additional: false });
	if (mode === 'linked') await chooseClipMediaSetting(properties, 'Link pitch and tempo');
	if (mode !== 'neutral') {
		const field = properties.getByRole('textbox', { name: mode === 'pitch' ? 'Pitch' : 'Speed', exact: true });
		await field.fill(mode === 'pitch' ? '12' : '200'); await field.press('Enter');
		await expect(field).toHaveValue(mode === 'pitch' ? '12' : '200');
	}
	await closeClipProperties(properties);
	if (variant.loop) {
		await clip.locator('.clip-header').click(); await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
		await editor.getByRole('button', { name: 'Fit project', exact: true }).click();
	}
	let canvas;
	if (variant.source) {
		const panel = await openSourceMonitor(page, editor, clip);
		await panel.getByRole('region', { name: 'Source vertical ruler', exact: true }).click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Spectrogram', exact: true }).click();
		canvas = panel.locator('[data-source-active="true"] canvas').first();
	} else {
		await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
		canvas = clip.locator('canvas.clip-body__waveform').first();
	}
	await expect(canvas).toHaveAttribute('data-spectrogram-renderer', 'pffft-wasm');
	await expect.poll(() => canvas.evaluate(element => element.__kwSpectrogramColumnsPlan?.channels?.[0]?.length ?? 0)).toBeGreaterThan(10);
	const paintedPeak = await canvas.evaluate(element => {
		const columns = element.__kwSpectrogramColumnsPlan.channels[0];
		const middle = columns[Math.floor(columns.length / 2)];
		let best = 0;
		for (let index = 1; index < middle.length; index++) if (middle[index] > middle[best]) best = index;
		return (best + .5) * 24_000 / middle.length;
	});
	const samples = await exportSamples(page, editor);
	const spectrum = calculateAudioSpectrum([Float32Array.from(samples.slice(8_000, 24_000))], 48_000, { size: 8192, average: true });
	const actualPeak = spectrum.bins.reduce((best, bin) => bin.amplitude > best.amplitude ? bin : best).frequency;
	expect(actualPeak).toBeCloseTo(mode === 'pitch' || mode === 'linked' ? 2000 : 1000, -1);
	expect(Math.abs(paintedPeak - actualPeak)).toBeLessThan(100);
	if (mode === 'pitch' && !variant.loop && !variant.source) {
		const changed = await openClipProperties(page, editor, clip, { additional: false });
		const pitch = changed.getByRole('textbox', { name: 'Pitch', exact: true });
		await pitch.fill('0'); await pitch.press('Enter'); await expect(pitch).toHaveValue('0'); await closeClipProperties(changed);
		await expect.poll(() => canvas.evaluate(element => {
			const columns = element.__kwSpectrogramColumnsPlan?.channels?.[0];
			if (!columns) return Infinity;
			const middle = columns[Math.floor(columns.length / 2)];
			const best = middle.indexOf(Math.max(...middle));
			return Math.abs((best + .5) * 24_000 / middle.length - 1000);
		})).toBeLessThan(100);
	}
});
