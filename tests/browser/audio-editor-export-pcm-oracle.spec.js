/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

// The integer ratio keeps this a fallback/clock witness, independent of native
// resamplers' fractional-ratio output-length rounding conventions.
test('downloaded native 48kHz and 96kHz WAV assertions retain their 48kHz programme clock', async ({ page }) => {
	const caseTimeout = test.info().timeout;
	test.setTimeout(caseTimeout * 2);
	await page.addInitScript(() => {
		const decode = BaseAudioContext.prototype.decodeAudioData;
		BaseAudioContext.prototype.decodeAudioData = function (...args) {
			if (globalThis.__observeWaveOracle) globalThis.__waveOracleDecodes++;
			return Reflect.apply(decode, this, args);
		};
	});
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [createWavFixture({ name: 'oracle.wav', frequency: 1000, duration: .1, channelCount: 1 })]);
	for (const rate of [48_000, 96_000]) await test.step(`${rate}Hz delivery`, async () => {
		await page.evaluate(() => { globalThis.__waveOracleDecodes = 0; globalThis.__observeWaveOracle = true; });
		const samples = await exportSamples(page, editor, { sampleRate: rate });
		expect(samples).toHaveLength(4800);
		expect(samples.every(Number.isFinite)).toBe(true);
		expect(samples.some(sample => Math.abs(sample) > .1)).toBe(true);
		expect(await page.evaluate(() => globalThis.__waveOracleDecodes)).toBe(rate === 48_000 ? 0 : 1);
	}, { timeout: caseTimeout });
});
