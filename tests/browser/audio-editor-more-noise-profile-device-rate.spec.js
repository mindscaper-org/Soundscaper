/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, closeDialog, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test.use({ browserCoverage: false });

test('a captured project noise profile remains audible on a different ordinary device clock', async ({ page }) => {
	await page.addInitScript(() => {
		const NativeContext = AudioContext;
		globalThis.AudioContext = class extends NativeContext {
			constructor(options) { super({ ...options, sampleRate: 44_100 }); }
		};
		globalThis.__noiseDeviceClock = [];
		const NativeWorklet = AudioWorkletNode;
		globalThis.AudioWorkletNode = class extends NativeWorklet {
			constructor(context, name, options) {
				super(context, name, options);
				if (!(context instanceof NativeContext) || options?.processorOptions?.effectType !== 'audacity-noise-reduction') return;
				const state = { rate: context.sampleRate, profileRate: options.processorOptions.noiseProfile.sampleRate, peak: 0, error: '' };
				globalThis.__noiseDeviceClock.push(state);
				this.port.addEventListener('message', ({ data }) => { if (data?.type === 'error') state.error = data.message; });
				this.port.start();
				const analyser = context.createAnalyser(); analyser.fftSize = 2048;
				this.connect(analyser);
				const samples = new Float32Array(analyser.fftSize);
				const timer = setInterval(() => {
					if (context.state === 'closed') { clearInterval(timer); return; }
					analyser.getFloatTimeDomainData(samples);
					state.peak = samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
				}, 20);
			}
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'device clock noise profile.wav', sampleRate: 48_000,
		frequency: 1000, duration: 8, channelCount: 2, channelAmplitudes: [.4, .4] })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Noise Reduction');
	const dialog = page.getByRole('dialog', { name: 'Noise Reduction', exact: true });
	await dialog.getByRole('button', { name: 'Get noise profile', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Replace noise profile', exact: true })).toBeVisible();
	await closeDialog(dialog);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__noiseDeviceClock.at(-1)?.peak ?? 0)).toBeGreaterThan(.01);
	const actual = await page.evaluate(() => globalThis.__noiseDeviceClock.at(-1));
	expect(actual.rate).toBe(44_100);
	expect(actual.profileRate).toBe(48_000);
	expect(actual.error).toBe('');
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
