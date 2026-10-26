/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

for (const phase of [0, Math.PI / 4]) test(`ordinary microphone dBFS retains sample peak with tone phase ${phase}`, async ({ page }) => {
	await page.addInitScript(({ phase }) => {
		const timeData = AnalyserNode.prototype.getFloatTimeDomainData;
		AnalyserNode.prototype.getFloatTimeDomainData = function (values) {
			Reflect.apply(timeData, this, [values]);
			if (this.fftSize === 256) {
				let peak = 0; for (const sample of values) peak = Math.max(peak, Math.abs(sample));
				window.__round6InputSamplePeak = peak;
				window.__round6InputSampleRate = this.context.sampleRate;
			}
		};
		const NativeNode = AudioWorkletNode;
		window.AudioWorkletNode = class extends NativeNode {
			constructor(context, name, options) {
				super(context, name, options);
				if (name === 'kw-ebu-r128-meter') {
					this.port.addEventListener('message', ({ data }) => {
						if (data.type === 'meter') {
							window.__round6InputReading = data.meter;
							if (data.meter.peak > .3) window.__round6InputReadings = (window.__round6InputReadings ?? 0) + 1;
						}
					});
					this.port.start();
				}
			}
		};
		Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
			enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'default', groupId: 'native-tone', label: 'Native tone microphone' }],
			async getUserMedia() {
				// Keep the quarter-rate phase oracle in the automatic project's clock.
				const context = new AudioContext({ sampleRate: 48_000 });
				const buffer = context.createBuffer(1, 4096, context.sampleRate);
				const samples = buffer.getChannelData(0);
				for (let frame = 0; frame < samples.length; frame++) samples[frame] = .6 * Math.sin(Math.PI / 2 * frame + phase);
				const source = context.createBufferSource(); source.buffer = buffer; source.loop = true;
				const destination = context.createMediaStreamDestination(); destination.channelCount = 1;
				source.connect(destination); source.start(); await context.resume();
				window.__round6Microphone = { context, source, destination };
				return destination.stream;
			},
		} });
	}, { phase });
	const editor = await bootEditor(page, '/embed/en/');
	let panel = editor.locator('[data-workspace-panel="recording-meter"]');
	if (!await panel.count()) await chooseNestedCommandAction(page, editor, 'Window', ['Recording meter']);
	panel = editor.locator('[data-workspace-panel="recording-meter"]');
	await panel.getByRole('button', { name: 'Record level', exact: true }).click();
	const settings = page.getByRole('dialog', { name: 'Record level', exact: true });
	await settings.getByRole('checkbox', { name: 'Show mic metering when not recording', exact: true }).check();
	await expect.poll(() => page.evaluate(() => window.__round6InputSamplePeak ?? 0)).toBeGreaterThan(.3);
	await expect.poll(() => page.evaluate(() => window.__round6InputReading?.peak ?? 0)).toBeGreaterThan(.3);
	await expect.poll(() => page.evaluate(() => window.__round6InputReadings ?? 0)).toBeGreaterThan(3);
	const samplePeak = await page.evaluate(() => window.__round6InputSamplePeak);
	const reading = await page.evaluate(() => window.__round6InputReading);
	expect(await page.evaluate(() => window.__round6Microphone.context.sampleRate)).toBe(48_000);
	expect(await page.evaluate(() => window.__round6InputSampleRate)).toBe(48_000);
	const displayed = Number(await panel.getByRole('meter', { name: 'Input level', exact: true }).getAttribute('aria-valuenow'));
	console.log('ordinary native microphone sample and true peak', { phase, samplePeak, displayed, reading });
	await settings.getByRole('checkbox', { name: 'Show mic metering when not recording', exact: true }).uncheck();
	expect(Math.abs(displayed - 20 * Math.log10(samplePeak))).toBeLessThan(.15);
	expect(Math.abs(reading.peak - samplePeak)).toBeLessThan(.002);
	const expectedSamplePeak = .6 * Math.max(Math.abs(Math.sin(phase)), Math.abs(Math.cos(phase)));
	expect(Math.abs(samplePeak - expectedSamplePeak)).toBeLessThan(.002);
});
