/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, closeEffectsPanel, collectClientErrors, importFiles,
	openEffectsForTrack, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { installMilestone7LocalAssistanceFixture } from './helpers/milestone-7-local-assistance.js';

// The fixture models the native PCM endpoint; the production AudioWorklet and graph run in Chromium.
test.use({ browserCoverage: false });
test.describe('real-time AI denoising rack', () => {
	registerAudioEditorHooks();
	for (const rate of [44100, 96000]) test(`opts in with ${rate} Hz playback, resamples mixed-rate tracks, and closes on stop`, async ({ page }) => {
		await installMilestone7LocalAssistanceFixture(page, [['dpdfnet2-48khz', '1.0.0', 'speech-enhancement']]);
		await page.addInitScript(rate => {
			const Native = globalThis.AudioContext;
			globalThis.AudioContext = class extends Native {
				constructor(options) { super({ ...options, sampleRate: rate }); globalThis.__aiDenoiseProbe.contextRates.push(this.sampleRate); }
			};
			globalThis.__aiDenoiseProbe = { opened: 0, blocks: 0, closed: 0, failed: false, energy: 0, rates: [], contextRates: [] };
			window.addEventListener('message', event => {
				if (event.source !== window || event.data?.type !== 'soundscaper-ai-denoise-connect-v1') return;
				const port = event.ports[0], channels = event.data.request.channelCount;
				globalThis.__aiDenoiseProbe.opened++;
				globalThis.__aiDenoiseProbe.rates.push(event.data.request.sampleRate);
				let previous = null, sequence = 0;
				port.onmessage = ({ data }) => {
					if (data.type === 'close') { globalThis.__aiDenoiseProbe.closed++; port.close(); return; }
					if (data.type !== 'block' || data.sequence !== sequence++ || data.input.length !== channels
						|| data.input.some(plane => plane.length !== 480)) globalThis.__aiDenoiseProbe.failed = true;
					const next = data.input.map(plane => plane.slice());
					for (const plane of next) for (const sample of plane) globalThis.__aiDenoiseProbe.energy += sample ** 2;
					for (let c = 0; c < channels; c++) {
						data.output[c].fill(0);
						if (previous) for (let i = 0; i < 480; i++) data.output[c][i] = previous[c][i] * .5;
					}
					data.outputFrames = previous ? 480 : 0;
					previous = next;
					globalThis.__aiDenoiseProbe.blocks++;
					port.postMessage(data, [...data.input, ...data.output].map(plane => plane.buffer));
				};
				port.start(); port.postMessage({ type: 'ready' });
			});
		}, rate);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		await importFiles(editor, [createWavFixture({ name: 'noisy-dialogue.wav', frequency: 330, duration: 10, sampleRate: 32000 }),
			createWavFixture({ name: 'noisy-dialogue-high-rate.wav', frequency: 440, duration: 10, sampleRate: 88200 })]);
		for (const track of [0, 1]) {
			const panel = await openEffectsForTrack(editor, track);
			await addRackEffect(page, panel, 'track', 'AI denoising (DPDFNet2)');
			await expect(panel).toContainText('AI denoising (DPDFNet2)');
			await closeEffectsPanel(panel);
		}
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__aiDenoiseProbe.blocks)).toBeGreaterThan(100);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__aiDenoiseProbe.closed)).toBe(2);
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__aiDenoiseProbe.opened)).toBe(4);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__aiDenoiseProbe.closed)).toBe(4);
		expect(await page.evaluate(() => globalThis.__aiDenoiseProbe.failed)).toBe(false);
		expect(await page.evaluate(() => globalThis.__aiDenoiseProbe.rates)).toEqual([48000, 48000, 48000, 48000]);
		expect(await page.evaluate(() => globalThis.__aiDenoiseProbe.contextRates)).toContain(rate);
		expect(await page.evaluate(() => globalThis.__aiDenoiseProbe.energy)).toBeGreaterThan(1);
		expect(errors).toEqual([]);
	});
});
