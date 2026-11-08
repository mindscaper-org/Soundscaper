/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForProjectActivation, collectClientErrors } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { createTakeFitProject } from '../helpers/take-fit-project.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const reopen of [true, false]) {
	test(`Take audition replays after natural end, reopening dialog=${String(reopen)}`, async ({ page }) => {
		await page.addInitScript(() => {
			globalThis.__takeAuditionOutputs = [];
			const connect = AudioNode.prototype.connect;
			AudioNode.prototype.connect = function (destination, ...ports) {
				const result = Reflect.apply(connect, this, [destination, ...ports]);
				if (destination === this.context.destination && this.context instanceof AudioContext) {
					const analyser = this.context.createAnalyser();
					analyser.fftSize = 2048;
					Reflect.apply(connect, this, [analyser, ...ports]);
					globalThis.__takeAuditionOutputs.push({ analyser, context: this.context });
				}
				return result;
			};
			globalThis.__readTakeOutputs = () => globalThis.__takeAuditionOutputs.map(({ analyser, context }) => {
				const samples = new Float32Array(analyser.fftSize);
				analyser.getFloatTimeDomainData(samples);
				return { time: context.currentTime, peak: samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0) };
			});
		});
		const errors = collectClientErrors(page), project = createTakeFitProject();
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
		let buffer;
		try {
			for (const source of project.sources) {
				const writer = await store.beginSourceWrite(source.storageKey, source);
				for (let offset = 0; offset < source.frameCount; offset += source.chunkFrames) {
					await writer.write([Float32Array.from({ length: Math.min(source.chunkFrames, source.frameCount - offset) },
						(_, frame) => .2 * Math.sin(2 * Math.PI * 440 * (frame + offset) / 48_000))]);
				}
				await writer.commit();
			}
			const { blob } = await exportScapeProject(project, store);
			buffer = Buffer.from(await blob.arrayBuffer());
		} finally { await store.close(); }
		const editor = await bootEditor(page, '/embed/en/');
		await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Take.sscape', mimeType: 'application/zip', buffer });
		await expect(editor).toHaveAttribute('data-project-id', project.id);
		await waitForProjectActivation(editor);
		const open = async () => {
			await chooseTrackMenuAction(page, editor, null, 'Take lanes and comps');
			const dialog = page.getByRole('dialog', { name: 'Take lanes and comps', exact: true });
			await expect(dialog).toBeVisible();
			return dialog;
		};
		let dialog = await open();
		const audition = () => dialog.getByRole('button', { name: 'Audition Recorded take.wav', exact: true });
		await audition().click();
		await expect.poll(() => outputPeak(page)).toBeGreaterThan(.03);
		const audibleAt = await page.evaluate(() => Math.max(...globalThis.__readTakeOutputs()
			.filter(output => output.peak > .03).map(output => output.time)));
		// Observe the real two-second take and advance its audio clock beyond
		// the terminal sample and the analyser's finite history before replaying.
		await expect.poll(() => page.evaluate(() => Math.max(...globalThis.__readTakeOutputs()
			.map(output => output.time)))).toBeGreaterThan(audibleAt + 2 + 2048 / 48_000);
		expect(await outputPeak(page)).toBeLessThan(.00001);
		if (reopen) {
			await page.keyboard.press('Escape');
			await expect(dialog).toBeHidden();
			dialog = await open();
		}
		await audition().click();
		await expect.poll(() => outputPeak(page)).toBeGreaterThan(.03);
		expect(errors).toEqual([]);
	});
}

async function outputPeak(page) {
	return page.evaluate(() => Math.max(0, ...globalThis.__readTakeOutputs().map(output => output.peak)));
}
