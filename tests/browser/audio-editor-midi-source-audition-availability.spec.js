/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, openSourceMonitor, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { writeMidiFile } from '../../src/common/editor/midi-file.ts';

registerAudioEditorHooks();

test('Source monitor offers pointer audition for available MIDI without a waveform cache', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await observeNativeOutput(page);
	const editor = await bootEditor(page, '/embed/en/');
	const wav = createWavFixture({ name: 'Ordinary audition.wav', frequency: 440, duration: 2, channelCount: 1 });
	await editor.locator('[data-import-input]').setInputFiles(wav);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	let panel = await openSourceMonitor(page, editor, clipByName(editor, wav.name));
	await expect(panel.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
	await panel.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(panel.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await expect.poll(() => outputPeak(page)).toBeGreaterThan(0.01);
	await panel.getByRole('button', { name: 'Stop', exact: true }).click();
	const midi = writeMidiFile({ sampleRate: 48_000, tempos: [{ frame: 0, bpm: 120 }], signatures: [],
		tracks: [{ name: 'MIDI audition', notes: [{ id: 'held', pitch: 60, velocity: 100, channel: 0,
			startFrame: 0, durationFrames: 192_000 }], events: [] }] });
	await editor.locator('[data-import-input]').setInputFiles({ name: 'MIDI audition.mid', mimeType: 'audio/midi', buffer: Buffer.from(midi) });
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	panel = await openSourceMonitor(page, editor, clipByName(editor, 'MIDI audition'));
	const waveform = panel.getByRole('region', { name: 'Source waveform', exact: true });
	await expect(waveform).toHaveAttribute('data-source-frame-count', '192000');
	await expect.poll(() => outputPeak(page)).toBeLessThan(0.0001);
	await expect(panel.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
	await panel.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(panel.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await expect.poll(() => outputPeak(page)).toBeGreaterThan(0.01);
	await expect.poll(async () => Number(await panel.getByRole('slider', { name: 'Source timeline', exact: true }).getAttribute('aria-valuenow'))).toBeGreaterThan(0);
	await panel.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect.poll(() => outputPeak(page)).toBeLessThan(0.0001);
	await waveform.focus();
	await waveform.press('Space');
	await expect(panel.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await expect.poll(() => outputPeak(page)).toBeGreaterThan(0.01);
	await panel.getByRole('button', { name: 'Stop', exact: true }).click();
});

function outputPeak(page) {
	return page.evaluate(() => window.__sourceAuditionPeak());
}

function observeNativeOutput(page) {
	return page.addInitScript(() => {
		const connect = AudioNode.prototype.connect, analysers = [];
		AudioNode.prototype.connect = function (...args) {
			const result = Reflect.apply(connect, this, args);
			if (args[0] === this.context.destination) {
				const analyser = this.context.createAnalyser(), silence = this.context.createGain();
				silence.gain.value = 0;
				// Retain the ordinary output; this independent zero-gain branch only observes its PCM.
				Reflect.apply(connect, this, [analyser]);
				Reflect.apply(connect, analyser, [silence]);
				Reflect.apply(connect, silence, [this.context.destination]);
				analysers.push(analyser);
			}
			return result;
		};
		window.__sourceAuditionPeak = () => Math.max(0, ...analysers.map(analyser => {
			const samples = new Float32Array(analyser.fftSize);
			analyser.getFloatTimeDomainData(samples);
			return Math.max(0, ...samples.map(Math.abs));
		}));
	});
}
