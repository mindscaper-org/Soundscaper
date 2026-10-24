/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, clipByName, closeDialog, collectClientErrors, commitInput, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test.use({ browserCoverage: false });

for (const effectName of ['Tremolo', 'Invert']) for (const topology of ['mixed-stereo', 'mono', 'stereo', 'surround', 'mixed-surround']) test(`${effectName} preserves ${topology} recording channels and listening magnitude`, async ({ page }) => {
	const errors = collectClientErrors(page);
	await page.addInitScript(() => {
		globalThis.__rackChannelOutput = [];
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (destination, ...ports) {
			const result = Reflect.apply(connect, this, [destination, ...ports]);
			if (destination === this.context.destination && this.context instanceof AudioContext) {
				const observer = this.context.createScriptProcessor(256, 2, 2);
				const silent = this.context.createGain(); silent.gain.value = 0;
				Reflect.apply(connect, this, [observer, ...ports]); Reflect.apply(connect, observer, [silent]);
				Reflect.apply(connect, silent, [this.context.destination]);
				observer.onaudioprocess = event => {
					const rms = [0, 1].map(channel => {
						const pcm = event.inputBuffer.getChannelData(channel);
						return Math.sqrt(pcm.reduce((power, sample) => power + sample * sample, 0) / pcm.length);
					});
					globalThis.__rackChannelOutput.push({ time: event.playbackTime, rms });
				};
			}
			return result;
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	const mixed = topology.startsWith('mixed');
	const width = topology.endsWith('surround') ? 6 : 2;
	const wide = createWavFixture({ name: 'Wide.wav', duration: .25, channelCount: width, channelAmplitudes: Array(width).fill(0) });
	const recording = createWavFixture({ name: 'Recording.wav', duration: 16, frequency: 1000,
		channelCount: mixed || topology === 'mono' ? 1 : width,
		channelAmplitudes: mixed || topology === 'mono' ? [.25] : [.25, .125, .08, .04, .02, .01].slice(0, width) });
	await importFiles(editor, mixed ? [wide, recording] : [recording]);
	if (mixed) {
		await clipByName(editor, recording.name).locator('.clip-header').click({ button: 'right' });
		const move = page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: /^Move to track \(preserve time\)/u });
		await move.hover(); await move.getByRole('menuitem', { name: /Wide/u }).click();
	}
	async function measure() {
		await page.evaluate(() => { globalThis.__rackChannelOutput = []; });
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(() => page.evaluate(() => {
			const sounding = globalThis.__rackChannelOutput.filter(value => value.rms[0] > .1);
			return sounding.length ? sounding.at(-1).time - sounding[0].time : 0;
		})).toBeGreaterThan(.6);
		const rms = await page.evaluate(() => globalThis.__rackChannelOutput.filter(value => value.rms[0] > .1).at(-1).rms);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		return rms;
	}
	const before = await measure();
	expect(before[0]).toBeGreaterThan(.12);
	if (topology === 'mono' || topology === 'mixed-stereo') expect(before[1] / before[0]).toBeGreaterThan(.99);
	const panel = await openEffectsForTrack(editor, 1); await addRackEffect(page, panel, 'track', effectName);
	if (effectName === 'Tremolo') {
		const dialog = page.getByRole('dialog', { name: 'Tremolo', exact: true });
		await commitInput(dialog.locator('[data-effect-param="depth"] input[type="number"]'), '0'); await closeDialog(dialog);
	}
	const after = await measure(); console.log('mixed-width neutral rack output', { effectName, topology, before, after });
	expect(Math.abs(after[0] - before[0])).toBeLessThan(.005);
	expect(Math.abs(after[1] - before[1])).toBeLessThan(.005);
	expect(errors).toEqual([]);
});
