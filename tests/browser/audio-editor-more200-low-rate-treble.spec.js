/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, commitInput, disableNativeSavePicker, openSelectionEffectDialog, openSourceMonitor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const rate of [6000, 8000]) test(`Source Monitor Bass and Treble applies to a ${rate}Hz recording`, async ({ page }) => {
	const input = Float32Array.from({ length: rate }, (_, frame) => .1 * Math.sin(2 * Math.PI * 100 * frame / rate));
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const nativeError = await page.evaluate(async ({ samples, rate }) => {
		const context = new OfflineAudioContext(1, samples.length, rate);
		const source = context.createBufferSource(); const buffer = context.createBuffer(1, samples.length, rate);
		buffer.copyToChannel(Float32Array.from(samples), 0); source.buffer = buffer;
		const shelf = context.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 4000; shelf.gain.value = 6;
		source.connect(shelf).connect(context.destination); source.start();
		const rendered = (await context.startRendering()).getChannelData(0);
		return Math.max(...rendered.map((sample, frame) => Math.abs(sample - samples[frame])));
	}, { samples: [...input], rate });
	expect(nativeError).toBeLessThan(1e-6);
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Low clock.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([input], { sampleRate: rate, float: true })) });
	await expect(editor.locator('[data-clip-id]')).toHaveCount(1); await waitForProjectActivation(editor);
	const panel = await openSourceMonitor(page, editor, editor.locator('[data-clip-id]'));
	await panel.getByRole('region', { name: 'Source waveform', exact: true }).press('Control+a');
	await expect(panel.locator('.audio-editor-source-selection')).toHaveCount(1);
	const dialog = await openSelectionEffectDialog(page, editor);
	await commitInput(dialog.locator('[data-effect-param="bassDb"] input'), '6');
	await commitInput(dialog.locator('[data-effect-param="trebleDb"] input'), '6');
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 20_000 });
	const output = await exportSamples(page, editor);
	expect(output).toHaveLength(48_000); expect(output.every(Number.isFinite)).toBe(true);
	const peak = Math.max(...output.map(Math.abs)); expect(peak).toBeGreaterThan(.09); expect(peak).toBeLessThan(.2);
});
