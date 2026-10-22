/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, closeDialog, commitInput, disableNativeSavePicker, importFiles,
	openEffectsForTrack } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test.use({ browserCoverage: false });

test('pitch-preserving playback includes the audible rack release after the recording ends', async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__speedTailBodies = [];
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.context instanceof AudioContext && this.buffer) {
				const samples = this.buffer.getChannelData(0);
				const from = Math.floor(this.buffer.sampleRate * .6); const to = Math.floor(this.buffer.sampleRate * .8);
				globalThis.__speedTailBodies.push({ frames: this.buffer.length, duration: this.buffer.duration,
					tail: samples.subarray(from, to).reduce((peak, value) => Math.max(peak, Math.abs(value)), 0) });
			}
			return Reflect.apply(start, this, args);
		};
	});
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'voice with delayed release.wav', frequency: 1000,
		duration: 1, channelCount: 2, channelAmplitudes: [.4, .4] })]);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Feedback delay');
	const effect = page.getByRole('dialog', { name: 'Feedback delay', exact: true });
	for (const [parameter, value] of [['time', '1'], ['feedback', '0'], ['mix', '1']]) {
		await commitInput(effect.locator(`[data-effect-param="${parameter}"] input[type="number"]`), value);
	}
	await closeDialog(effect);
	const rendered = await exportSamples(page, editor);
	expect(rendered.length).toBeGreaterThan(90_000);
	expect(Math.max(...rendered.slice(57_600, 76_800).map(Math.abs))).toBeGreaterThan(.1);
	await editor.getByRole('button', { name: 'Play options', exact: true }).click();
	const preserve = editor.getByRole('menuitem', { name: 'Preserve pitch', exact: true });
	if (await preserve.getAttribute('aria-checked') !== 'true') await preserve.click();
	await editor.getByRole('slider', { name: 'Playback speed', exact: true }).fill('2');
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'Play at speed', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__speedTailBodies.length)).toBeGreaterThan(0);
	const prepared = await page.evaluate(() => globalThis.__speedTailBodies.at(-1));
	expect(prepared.duration).toBeGreaterThan(.9);
	expect(prepared.tail).toBeGreaterThan(.01);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
