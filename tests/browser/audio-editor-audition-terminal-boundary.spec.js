/* SPDX-License-Identifier: AGPL-3.0-only */

import { test, expect, createWavFixture } from './audio-editor-test-fixtures.js';
import {
	bootEditor, importFiles, clipByName, openSourceMonitor, collectClientErrors,
} from './audio-editor-test-helpers.js';

for (const audition of ['source-range', 'source-full', 'bin']) {
	test(`the ${audition} audition stops at its media end and can replay`, async ({ page }) => {
		await installAuditionOutputProbe(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const recording = createWavFixture({ name: 'Finite audition.wav', frequency: 440,
			duration: 1, channelCount: 1, channelAmplitudes: [.1] });
		await importFiles(editor, [recording]);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		let play, pause, position;
		let selectedEnd = 1;
		if (audition.startsWith('source')) {
			const source = await openSourceMonitor(page, editor, clipByName(editor, recording.name));
			if (audition === 'source-range') {
				const waveform = source.getByRole('region', { name: 'Source waveform', exact: true });
				const box = await waveform.boundingBox();
				expect(box).not.toBeNull();
				await waveform.evaluate(value => value.addEventListener('pointerup', event => {
					const bounds = value.getBoundingClientRect();
					globalThis.__auditionSelectedEnd = Math.round((event.clientX - bounds.left) / bounds.width * 48_000) / 48_000;
				}, { once: true }));
				await page.mouse.move(box.x + box.width * .1, box.y + 80);
				await page.mouse.down();
				await page.mouse.move(box.x + box.width * .8, box.y + 80, { steps: 5 });
				await page.mouse.up();
				await expect(waveform.locator('.audio-editor-source-selection')).toBeVisible();
				selectedEnd = await page.evaluate(() => globalThis.__auditionSelectedEnd);
			}
			play = source.getByRole('button', { name: 'Play', exact: true });
			pause = source.getByRole('button', { name: 'Pause', exact: true });
			position = source.getByRole('slider', { name: 'Source timeline', exact: true });
		} else {
			await clipByName(editor, recording.name).locator('.clip-header').click({ button: 'right' });
			await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
			const card = editor.locator('[data-project-bin-item]').first();
			play = card.getByRole('button', { name: /^Play:/u });
			pause = card.getByRole('button', { name: /^Pause:/u });
		}
		await play.click();
		await expect(pause).toBeVisible();
		await expect.poll(() => outputPeak(page)).toBeGreaterThan(.03);
		const audibleAt = await page.evaluate(() => Math.max(...globalThis.__readAuditionOutputs()
			.filter(output => output.peak > .03).map(output => output.time)));
		// Observe actual destination PCM and advance its audio clock beyond the
		// one-second asset plus the analyser's finite history, independently of JS delays.
		await expect.poll(() => page.evaluate(() => Math.max(...globalThis.__readAuditionOutputs()
			.map(output => output.time)))).toBeGreaterThan(audibleAt + 1 + 2048 / 48000);
		expect(await outputPeak(page)).toBeLessThan(.00001);
		await expect(play).toBeVisible();
		if (position) expect(Number(await position.getAttribute('aria-valuenow'))).toBe(selectedEnd);
		await play.click();
		await expect(pause).toBeVisible();
		await expect.poll(() => outputPeak(page)).toBeGreaterThan(.03);
		expect(errors).toEqual([]);
	});
}

async function outputPeak(page) {
	return page.evaluate(() => Math.max(0, ...globalThis.__readAuditionOutputs().map(output => output.peak)));
}

for (const completed of [false, true]) {
	test(`a different Bin file plays from zero after ${completed ? 'natural end' : 'explicit Pause'}`, async ({ page }) => {
		await installAuditionOutputProbe(page);
		const editor = await bootEditor(page, '/embed/en/');
		const first = createWavFixture({ name: 'First.wav', frequency: 440, duration: 1,
			channelCount: 1, channelAmplitudes: [.1] });
		const second = createWavFixture({ name: 'Shorter.wav', frequency: 660, duration: .75,
			channelCount: 1, channelAmplitudes: [.1] });
		await importFiles(editor, [first, second]);
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		for (const file of [first, second]) {
			await clipByName(editor, file.name).locator('.clip-header').click({ button: 'right' });
			await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
		}
		const firstCard = editor.locator('[data-project-bin-item]').filter({
			has: page.getByRole('button', { name: /^(?:Play|Pause): First$/u }),
		});
		const secondCard = editor.locator('[data-project-bin-item]').filter({
			has: page.getByRole('button', { name: /^(?:Play|Pause): Shorter$/u }),
		});
		await firstCard.getByRole('button', { name: 'Play: First', exact: true }).click();
		await expect.poll(() => outputPeak(page)).toBeGreaterThan(.03);
		if (completed) {
			await expect(firstCard.getByRole('button', { name: 'Play: First', exact: true })).toBeVisible();
			await expect.poll(() => outputPeak(page)).toBeLessThan(.00001);
		} else {
			await firstCard.getByRole('button', { name: 'Pause: First', exact: true }).click();
		}
		await secondCard.getByRole('button', { name: 'Play: Shorter', exact: true }).click();
		await expect.poll(() => outputPeak(page)).toBeGreaterThan(.03);
	});
}

async function installAuditionOutputProbe(page) {
	await page.addInitScript(() => {
		globalThis.__auditionOutputs = [];
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (destination, ...ports) {
			const result = Reflect.apply(connect, this, [destination, ...ports]);
			if (destination === this.context.destination && this.context instanceof AudioContext) {
				const analyser = this.context.createAnalyser();
				analyser.fftSize = 2048;
				Reflect.apply(connect, this, [analyser, ...ports]);
				globalThis.__auditionOutputs.push({ analyser, context: this.context });
			}
			return result;
		};
		globalThis.__readAuditionOutputs = () => globalThis.__auditionOutputs.map(({ analyser, context }) => {
			const samples = new Float32Array(analyser.fftSize);
			analyser.getFloatTimeDomainData(samples);
			return { time: context.currentTime, peak: samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0) };
		});
	});
}
