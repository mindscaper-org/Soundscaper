/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone, persistedProject } from './helpers/complex-editing-workflows.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { sourcePeakChannels } from './helpers/stored-source-probes.js';

test.use({ browserCoverage: false });

for (const when of ['before', 'during']) test(`Record level zero ${when} cold recorder preparation reaches captured PCM`, async ({ page }) => {
	await installOscillatorMicrophone(page);
	await disableNativeSavePicker(page);
	await page.addInitScript(() => {
		globalThis.__recordGainPeaks = [];
		globalThis.__recordGainPreparing = false;
		const addModule = Worklet.prototype.addModule;
		Worklet.prototype.addModule = async function (url, ...options) {
			// Intercept either AudioContext constructor alias and retain native PCM.
			if (String(url).includes('recording-worklet-')) {
				globalThis.__recordGainPreparing = true;
				await new Promise(resolve => { globalThis.__releaseRecordGain = resolve; });
			}
			return Reflect.apply(addModule, this, [url, ...options]);
		};
		const NativeWorklet = AudioWorkletNode;
		globalThis.AudioWorkletNode = class extends NativeWorklet {
			constructor(context, name, options) {
				super(context, name, options);
				if (name !== 'kw-audio-recorder') return;
				this.port.addEventListener('message', ({ data }) => {
					if (data.type !== 'audio-chunk') return;
					let peak = 0;
					for (const channel of data.channels) for (const sample of new Float32Array(channel)) {
						peak = Math.max(peak, Math.abs(sample));
					}
					globalThis.__recordGainPeaks.push(peak);
				});
				this.port.start();
			}
		};
	});
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	const projectId = await editor.getAttribute('data-project-id');
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	const silenceInput = async () => {
		await editor.getByRole('button', { name: 'Record level', exact: true }).click();
		const level = page.getByRole('slider', { name: 'Record level', exact: true });
		await expect(level).toBeEnabled();
		await level.press('Home');
		await expect(level).toHaveValue('-60');
		await page.keyboard.press('Escape');
	};
	if (when === 'before') await silenceInput();
	try {
		await record.click();
		await expect.poll(() => page.evaluate(() => globalThis.__recordGainPreparing)).toBe(true);
		if (when === 'during') await silenceInput();
		await page.evaluate(() => globalThis.__releaseRecordGain());
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		await expect.poll(() => page.evaluate(() => globalThis.__recordGainPeaks.length)).toBeGreaterThanOrEqual(3);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(record).toHaveAttribute('aria-pressed', 'false');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const project = await persistedProject(page, projectId);
		expect(project.sources).toHaveLength(1);
		expect(project.sources[0].frameCount).toBeGreaterThan(4096);
		await expect.poll(async () => (await sourcePeakChannels(page, project.sources[0].name)).channels.length).toBe(1);
		const stored = await sourcePeakChannels(page, project.sources[0].name);
		expect(stored.channelCount).toBe(1);
		expect(stored.version).toBeGreaterThan(0);
		const storedPeak = Math.max(...stored.channels.flatMap(channel => [Math.abs(channel.minimum), Math.abs(channel.maximum)]));
		const samples = await exportSamples(page, editor);
		expect(storedPeak, 'persisted source samples retain the displayed zero input level').toBe(0);
		expect(await page.evaluate(() => Math.max(...globalThis.__recordGainPeaks))).toBe(0);
		expect(Math.max(...samples.map(Math.abs)), 'delivered PCM stays silent within one quantization step').toBeLessThan(1 / 32768);
		expect(errors).toEqual([]);
	} finally {
		await page.evaluate(() => globalThis.__releaseRecordGain?.());
	}
});
