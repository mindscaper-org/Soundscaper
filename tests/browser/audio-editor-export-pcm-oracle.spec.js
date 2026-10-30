/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

// The integer ratio keeps this a fallback/clock witness, independent of native
// resamplers' fractional-ratio output-length rounding conventions.
for (const rate of [48_000, 96_000]) test(`downloaded ${rate}Hz WAV assertions retain their 48kHz programme clock`, async ({ page }) => {
	await page.addInitScript(() => {
		const decode = BaseAudioContext.prototype.decodeAudioData;
		BaseAudioContext.prototype.decodeAudioData = function (...args) {
			if (globalThis.__observeWaveOracle) globalThis.__waveOracleDecodes++;
			return Reflect.apply(decode, this, args);
		};
	});
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'oracle.wav', frequency: 1000, duration: .1, channelCount: 1 })]);
	await page.evaluate(() => { globalThis.__waveOracleDecodes = 0; globalThis.__observeWaveOracle = true; });
	const samples = await exportSamples(page, editor, { sampleRate: rate });
	expect(samples).toHaveLength(4800);
	expect(samples.every(Number.isFinite)).toBe(true);
	expect(samples.some(sample => Math.abs(sample) > .1)).toBe(true);
	expect(await page.evaluate(() => globalThis.__waveOracleDecodes)).toBe(rate === 48_000 ? 0 : 1);
});
