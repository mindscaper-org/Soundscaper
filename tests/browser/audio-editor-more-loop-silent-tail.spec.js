/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test.use({ browserCoverage: false });

test('Loop to selection plays the silence after a short recording before repeating its audio', async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__silentLoopOutputs = [];
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (destination, ...ports) {
			const result = Reflect.apply(connect, this, [destination, ...ports]);
			if (this.context instanceof AudioContext && destination === this.context.destination) {
				const analyser = this.context.createAnalyser(); analyser.fftSize = 1024;
				Reflect.apply(connect, this, [analyser]);
				const state = { context: this.context, started: null, readings: [] };
				globalThis.__silentLoopOutputs.push(state);
				const samples = new Float32Array(analyser.fftSize);
				const timer = setInterval(() => {
					if (this.context.state === 'closed') { clearInterval(timer); return; }
					analyser.getFloatTimeDomainData(samples);
					const peak = samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
					if (peak > .1 && state.started === null) state.started = this.context.currentTime;
					state.readings.push({ time: this.context.currentTime, peak });
					if (state.readings.length > 500) state.readings.shift();
				}, 20);
			}
			return result;
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'one second loop.wav', frequency: 1000,
		duration: 1, channelCount: 2, channelAmplitudes: [.4, .4] })]);
	const clip = await clipByName(editor, 'one second loop.wav').locator('.clip-display').boundingBox();
	const ruler = await editor.locator('[data-ruler]').boundingBox();
	await page.mouse.move(clip.x + clip.width / 4, ruler.y + 26); await page.mouse.down();
	await page.mouse.move(clip.x + clip.width * 2, ruler.y + 26, { steps: 6 }); await page.mouse.up();
	await expect(editor.getByRole('group', { name: 'Selection end', exact: true }).locator('.timecode__display')).toHaveText('00h00m02.000s');
	await chooseNestedCommandAction(page, editor, 'Select', ['Loop region', 'Set loop to selection']);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__silentLoopOutputs.some(output => output.started !== null
		&& output.readings.some(reading => reading.time - output.started > 2.5)))).toBe(true);
	const periods = await page.evaluate(() => {
		const output = globalThis.__silentLoopOutputs.find(state => state.started !== null);
		const peak = (from, to) => Math.max(0, ...output.readings.filter(reading => reading.time - output.started > from
			&& reading.time - output.started < to).map(reading => reading.peak));
		return { initial: peak(.2, .6), silence: peak(1.2, 1.6), repeated: peak(2.2, 2.6) };
	});
	expect(periods.initial).toBeGreaterThan(.1);
	expect(periods.silence).toBeLessThan(.0001);
	expect(periods.repeated).toBeGreaterThan(.1);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
