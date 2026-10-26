/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, closeClipProperties, collectClientErrors, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

for (const mode of ['pitch', 'tempo']) test(`Project Bin ${mode} audition retains the authored pitch`, async ({ page }) => {
	await page.addInitScript(() => {
		const NativeWorker = window.Worker;
		globalThis.__holdBinRender = false;
		globalThis.__heldBinRender = false;
		window.Worker = class extends NativeWorker {
			constructor(url, options) {
				super(url, options);
				if (options?.name !== 'audacity-staffpad-render') return;
				const post = this.postMessage.bind(this);
				this.postMessage = (message, ...ports) => {
					if (message?.type === 'render' && globalThis.__holdBinRender) {
						globalThis.__holdBinRender = false; globalThis.__heldBinRender = true;
						return;
					}
					post(message, ...ports);
				};
			}
		};
		globalThis.__binPreviewFrequencies = [];
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (destination, ...ports) {
			const result = Reflect.apply(connect, this, [destination, ...ports]);
			if (destination !== this.context.destination || !(this.context instanceof AudioContext)) return result;
			const analyser = this.context.createAnalyser();
			analyser.fftSize = 16384;
			Reflect.apply(connect, this, [analyser]);
			const reading = { frequency: 0, db: -Infinity };
			globalThis.__binPreviewFrequencies.push(reading);
			const bins = new Float32Array(analyser.frequencyBinCount);
			const timer = setInterval(() => {
				if (this.context.state === 'closed') { clearInterval(timer); return; }
				analyser.getFloatFrequencyData(bins);
				let peak = -Infinity, index = 0;
				for (let bin = 1; bin < bins.length; bin++) if (bins[bin] > peak) { peak = bins[bin]; index = bin; }
				if (peak > reading.db) { reading.db = peak; reading.frequency = index * this.context.sampleRate / analyser.fftSize; }
			}, 20);
			return result;
		};
	});
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: `Bin ${mode}.wav`, frequency: 440, duration: 2, channelCount: 1 })]);
	const clip = editor.locator('[data-clip-id]').first();
	const properties = await openClipProperties(page, editor, clip, { additional: false });
	const field = properties.getByRole('textbox', { name: mode === 'pitch' ? 'Pitch' : 'Speed', exact: true });
	await field.fill(mode === 'pitch' ? '3' : '200');
	await field.press('Enter');
	await expect(field).toHaveValue(mode === 'pitch' ? '3' : '200');
	await closeClipProperties(properties);
	await clip.locator('.clip-header').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const card = editor.locator('[data-project-bin-item]').first();
	if (mode === 'pitch') await page.evaluate(() => { globalThis.__holdBinRender = true; });
	await card.getByRole('button', { name: /^Play:/u }).click();
	if (mode === 'pitch') {
		await expect.poll(() => page.evaluate(() => globalThis.__heldBinRender)).toBe(true);
		await card.getByRole('button', { name: /^Pause:/u }).click();
		await card.getByRole('button', { name: /^Play:/u }).click();
	}
	await expect(card.getByRole('button', { name: /^Pause:/u })).toBeVisible();
	const expected = mode === 'pitch' ? 440 * 2 ** (3 / 12) : 440;
	await expect.poll(() => page.evaluate(frequency => globalThis.__binPreviewFrequencies.some(reading =>
		reading.db > -40 && Math.abs(reading.frequency - frequency) < 5), expected), { timeout: 15_000 }).toBe(true);
	await expect(editor.getByRole('alert')).toHaveCount(0);
	expect(errors).toEqual([]);
});
