/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ordinaryBrowserProductSitePlan } from '../../scripts/lib/browser-product-site-plan.mjs';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, commitInput, importFiles, openEffectsForTrack, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';

// Counting render-thread blocks changes the realtime deadline being measured.
test.use({ browserCoverage: false });

const OUTPUT_PROBE = `class DynamicsOutputProbe extends AudioWorkletProcessor {
	constructor() { super(); this.batch = []; }
	process(inputs) {
		const samples = inputs[0]?.[0];
		if (samples?.length) {
			let power = 0;
			for (const sample of samples) power += sample ** 2;
			this.batch.push({ time: currentTime, frames: samples.length, rms: Math.sqrt(power / samples.length) });
			if (this.batch.length === 32) { this.port.postMessage(this.batch); this.batch = []; }
		}
		return true;
	}
}
registerProcessor('dynamics-output-probe', DynamicsOutputProbe);`;

test('a live Compressor release edit preserves the already audible recording at unchanged lookahead geometry', async ({ page }) => {
	const [soundscaperSite] = ordinaryBrowserProductSitePlan().sites;
	const probeName = `test-dynamics-output-${randomUUID()}.js`;
	const probePath = resolve(soundscaperSite.outputDirectory, probeName);
	// Chromium worklet fetches bypass Playwright routing. Serve the owned probe
	// from the disposable test site with Vite's normal origin/security headers.
	await writeFile(probePath, OUTPUT_PROBE);
	try {
		await page.addInitScript(moduleUrl => {
			window.__round6DynamicsOutput = [];
			window.__round6DynamicsProbeError = null;
			window.__round6DynamicsBufferedSources = [];
			const start = AudioBufferSourceNode.prototype.start;
			AudioBufferSourceNode.prototype.start = function (...arguments_) {
				if (this.buffer) window.__round6DynamicsBufferedSources.push({
					frames: this.buffer.length, sampleRate: this.buffer.sampleRate, channels: this.buffer.numberOfChannels,
					quarterCycleSample: this.buffer.getChannelData(0)[12],
				});
				return Reflect.apply(start, this, arguments_);
			};
			const modules = new WeakMap();
			const connect = AudioNode.prototype.connect;
			AudioNode.prototype.connect = function (destination, ...ports) {
				const result = Reflect.apply(connect, this, [destination, ...ports]);
				if (destination === this.context.destination && this.context instanceof AudioContext) {
					const context = this.context;
					if (!modules.has(context)) modules.set(context, context.audioWorklet.addModule(moduleUrl));
					void modules.get(context).then(() => {
						const probe = new AudioWorkletNode(context, 'dynamics-output-probe');
						probe.port.onmessage = event => window.__round6DynamicsOutput.push(...event.data);
						Reflect.apply(connect, this, [probe, ...ports]);
						Reflect.apply(connect, probe, [context.destination]);
					}).catch(error => { window.__round6DynamicsProbeError = String(error); });
				}
				return result;
			};
		}, `/${probeName}`);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({ name: 'continuous Compressor recording.wav',
			frequency: 1000, duration: 16, sampleRate: 48_000, channelCount: 1, channelAmplitudes: [.6] })]);
		// Reopening this short recording activates its resident AudioBuffer path.
		// The continuity assertion then isolates the live DSP edit from streamed
		// source/storage scheduling on the browser's main thread.
		const projectId = await editor.getAttribute('data-project-id');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		await waitForEditor(page);
		await expect(editor).toHaveAttribute('data-project-id', projectId);
		await waitForProjectActivation(editor);
		const panel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, panel, 'track', 'Compressor');
		const dialog = page.getByRole('dialog', { name: 'Compressor', exact: true });
		for (const [name, value] of [['thresholdDb', '0'], ['makeupGainDb', '0'], ['kneeWidthDb', '0'], ['ratio', '1'], ['lookaheadMs', '200']]) {
			await commitInput(dialog.locator(`[data-effect-param="${name}"] input[type="number"]`), value);
		}
		const release = dialog.locator('[data-effect-param="releaseMs"] input[type="number"]');
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(() => page.evaluate(() => window.__round6DynamicsBufferedSources)).toContainEqual(expect.objectContaining({
			frames: 768_000, sampleRate: 48_000, channels: 1,
		}));
		await expect.poll(() => page.evaluate(() => window.__round6DynamicsBufferedSources
			.find(source => source.frames === 768_000)?.quarterCycleSample)).toBeCloseTo(.6, 3);
		await expect.poll(() => page.evaluate(() => {
			if (window.__round6DynamicsProbeError) throw new Error(window.__round6DynamicsProbeError);
			return window.__round6DynamicsOutput.length;
		})).toBeGreaterThan(0);
		// Establish continuous output after graph startup and lookahead priming.
		await expect.poll(() => page.evaluate(() => {
			const samples = window.__round6DynamicsOutput;
			const last = samples.at(-1);
			const silence = samples.findLastIndex(sample => sample.rms <= .2);
			return last && samples[silence + 1] ? last.time - samples[silence + 1].time : 0;
		}), { timeout: 10_000 }).toBeGreaterThan(.3);
		const healthy = await page.evaluate(() => {
			const samples = window.__round6DynamicsOutput;
			return samples.filter(sample => sample.time >= samples.at(-1).time - .3);
		});
		expect(Math.min(...healthy.map(sample => sample.rms))).toBeGreaterThan(.2);
		const changedAt = await page.evaluate(() => window.__round6DynamicsOutput.at(-1).time);
		await commitInput(release, '101');
		await expect(release).toHaveValue('101');
		await expect.poll(() => page.evaluate(time => window.__round6DynamicsOutput.at(-1).time - time, changedAt)).toBeGreaterThan(.6);
		const changed = await page.evaluate(time => window.__round6DynamicsOutput.filter(sample => sample.time > time), changedAt);
		console.log('ordinary live Compressor edit native output', {
			beforeMinimumRms: Math.min(...healthy.map(sample => sample.rms)),
			afterMinimumRms: Math.min(...changed.map(sample => sample.rms)),
			lostFrames: changed.filter(sample => sample.rms < .01).reduce((sum, sample) => sum + sample.frames, 0),
		});
		expect(Math.min(...changed.map(sample => sample.rms))).toBeGreaterThan(.2);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	} finally {
		await rm(probePath, { force: true });
	}
});
