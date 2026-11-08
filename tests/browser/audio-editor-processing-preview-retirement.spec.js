/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

for (const bin of [false, true]) test(`Amplify Preview hears only its result with a prior Bin audition=${bin}`, async ({ page }) => {
	await installPreviewSpectrum(page);
	const editor = await bootEditor(page, '/embed/en/');
	const selected = createWavFixture({ name: 'Selected 440.wav', sampleRate: 16000, duration: 20, frequency: 440, channelCount: 1, channelAmplitudes: [.2] });
	const other = createWavFixture({ name: 'Bin 880.wav', sampleRate: 16000, duration: 20, frequency: 880, channelCount: 1, channelAmplitudes: [.2] });
	await importFiles(editor, [selected, other]);
	await clipByName(editor, other.name).locator('.clip-header').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	await clipByName(editor, selected.name).locator('.clip-header').click();
	const card = editor.locator('[data-project-bin-item]').first();
	if (bin) {
		await card.getByRole('button', { name: /^Play:/u }).click();
		await expect.poll(() => previewFrequency(page, 880)).toBeGreaterThan(-35);
	}
	await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Amplify']);
	const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await effect.getByRole('button', { name: 'Preview', exact: true }).click();
	await expect.poll(() => previewFrequency(page, 440)).toBeGreaterThan(-35);
	await expect.poll(() => previewFrequency(page, 880)).toBeLessThan(-70);
	if (bin) await expect(card.getByRole('button', { name: /^Play:/u, includeHidden: true })).toBeVisible();
	await expect(editor.getByRole('alert')).toHaveCount(0);
});

async function previewFrequency(page, frequency) {
	return page.evaluate(hz => window.__processingPreviewFrequencies()[hz], frequency);
}

async function installPreviewSpectrum(page) {
	await page.addInitScript(() => {
		const connect = AudioNode.prototype.connect, outputs = [];
		AudioNode.prototype.connect = function (destination, ...ports) {
			const result = Reflect.apply(connect, this, [destination, ...ports]);
			if (destination === this.context.destination && this.context instanceof AudioContext) {
				const analyser = this.context.createAnalyser(); analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0;
				Reflect.apply(connect, this, [analyser, ...ports]); outputs.push(analyser);
			}
			return result;
		};
		window.__processingPreviewFrequencies = () => {
			const peaks = { 440: -Infinity, 880: -Infinity };
			for (const analyser of outputs) {
				if (analyser.context.state === 'closed') continue;
				const data = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(data);
				for (const hz of [440, 880]) {
					const index = Math.round(hz * analyser.fftSize / analyser.context.sampleRate);
					for (let bin = index - 1; bin <= index + 1; bin++) peaks[hz] = Math.max(peaks[hz], data[bin]);
				}
			}
			return peaks;
		};
	});
}
