/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker, openClipProperties, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { chooseClipMediaSetting, expectClipSampleRate } from './audio-editor-clip-settings-test-helpers.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { exportSamples } from './helpers/round2-audio-export.js';

function amplitude(samples, frequency) {
	const selected = samples.slice(4800, 19_200); let sine = 0; let cosine = 0;
	for (const [frame, sample] of selected.entries()) {
		const phase = 2 * Math.PI * frequency * frame / 48_000;
		sine += sample * Math.sin(phase); cosine += sample * Math.cos(phase);
	}
	return 2 * Math.hypot(sine, cosine) / selected.length;
}

for (const rate of [8000, 48_000]) test(`File Resample to ${rate} Hz preserves its supported band without an aliased tone`, async ({ page }) => {
	const samples = Float32Array.from({ length: 48_000 }, (_, frame) => .2 * (Math.sin(2 * Math.PI * 1000 * frame / 96_000)
		+ Math.sin(2 * Math.PI * 6000 * frame / 96_000)));
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'High rate.wav', mimeType: 'audio/wav',
		buffer: Buffer.from(encodeWav([samples], { sampleRate: 96_000, float: true })) });
	await expect(editor.locator('[data-clip-id]')).toHaveCount(1); await waitForProjectActivation(editor);
	const properties = await openClipProperties(page, editor, editor.locator('[data-clip-id]'));
	await chooseClipMediaSetting(properties, 'Resample');
	const dialog = page.getByRole('dialog', { name: 'Resample clip', exact: true });
	await dialog.getByRole('textbox', { name: /^Sample rate \(Hz\)/u }).fill(String(rate));
	await dialog.getByRole('button', { name: 'Resample', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 20_000 }); await expectClipSampleRate(properties, rate);
	const output = await exportSamples(page, editor); expect(output).toHaveLength(24_000);
	expect(amplitude(output, 1000)).toBeGreaterThan(.13);
	expect(amplitude(output, 2000)).toBeLessThan(.0001);
	if (rate === 48_000) expect(amplitude(output, 6000)).toBeGreaterThan(.13);
	await chooseCommandAction(page, editor, 'Edit', 'Undo'); await expectClipSampleRate(properties, 96_000);
	await chooseCommandAction(page, editor, 'Edit', 'Redo'); await expectClipSampleRate(properties, rate);
});
