/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, closeClipProperties, disableNativeSavePicker, downloadBytes, importFiles, openClipProperties, openSourceMonitor, chooseExportProjectFileAction } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { calculateAudioSpectrum } from '../../src/common/editor/audio-spectrum.ts';

for (const variant of [{ rate: 24_000 }, { rate: 48_000 }, { rate: 96_000 }, { rate: 24_000, pitch: true }]) test(`Source Editor painted frequency matches audible PCM for ${variant.rate}Hz input; pitch=${!!variant.pitch}`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Clock48.wav', sampleRate: 48_000, duration: .2, frequency: 50, channelCount: 1 })]);
	await importFiles(editor, [createWavFixture({ name: 'Source tone.wav', sampleRate: variant.rate, duration: 2, frequency: 1000, channelCount: 1 })]);
	const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const project = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	expect(project.sampleRate).toBe(48_000); expect(project.sources.find(source => source.name === 'Source tone.wav').sampleRate).toBe(variant.rate);
	const clip = editor.locator('[data-clip-id]').filter({ has: page.locator('.clip-header', { hasText: 'Source tone' }) }).first();
	if (variant.pitch) {
		const properties = await openClipProperties(page, editor, clip, { additional: false });
		const pitch = properties.getByRole('textbox', { name: 'Pitch', exact: true });
		await pitch.fill('12'); await pitch.press('Enter'); await expect(pitch).toHaveValue('12'); await closeClipProperties(properties);
	}
	const panel = await openSourceMonitor(page, editor, clip);
	const ruler = panel.getByRole('region', { name: 'Source vertical ruler', exact: true });
	await ruler.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Spectrogram', exact: true }).click();
	const canvas = panel.locator('[data-source-active="true"] canvas').first();
	await expect(canvas).toHaveAttribute('data-spectrogram-renderer', 'pffft-wasm');
	const maximumText = await ruler.locator('.vertical-ruler__tick--first .vertical-ruler__label').first().textContent();
	const maximum = maximumText.endsWith('k') ? Number(maximumText.slice(0, -1)) * 1000 : Number(maximumText);
	expect(maximum).toBe(Math.min(48_000, variant.rate) / 2);
	const paintedFrequency = await canvas.evaluate((element, max) => {
		const { data } = element.getContext('2d').getImageData(0, 0, element.width, element.height);
		const energy = Array(element.height).fill(0);
		for (let y = 0; y < element.height; y++) for (let x = Math.floor(element.width * .4); x < element.width * .6; x++) {
			const offset = (y * element.width + x) * 4; energy[y] += data[offset] + data[offset + 1] + data[offset + 2];
		}
		return (1 - (energy.indexOf(Math.max(...energy)) + .5) / element.height) * max;
	}, maximum);
	const samples = await exportSamples(page, editor);
	const spectrum = calculateAudioSpectrum([Float32Array.from(samples.slice(24_000, 40_000))], 48_000, { size: 8192, average: true });
	const actual = spectrum.bins.reduce((best, bin) => bin.amplitude > best.amplitude ? bin : best).frequency;
	expect(actual).toBeCloseTo(variant.pitch ? 2000 : 1000, -1);
	expect(Math.abs(paintedFrequency - actual)).toBeLessThan(120);
});
