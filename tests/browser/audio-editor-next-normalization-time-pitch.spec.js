/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, closeClipProperties, disableNativeSavePicker, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { readClipGain, setClipGain } from './audio-editor-clip-settings-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const warmed of [false, true]) test(`Clip peak normalization measures committed independent pitch (cache warmed ${String(warmed)})`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'transient.wav', duration: 2, frequency: 500, channelCount: 1 });
	recording.buffer.fill(0, 44);
	for (let frame = 0; frame < 100; frame++) recording.buffer.writeInt16LE(Math.round(Math.sin(frame * Math.PI / 100) * 16000), 44 + (24_000 + frame) * 2);
	await importFiles(editor, [recording]);
	// Hard-left mono routing retains unity on the exported left channel.
	await editor.getByRole('slider', { name: 'Pan: 0', exact: true }).last().press('Home');
	const clip = editor.locator('[data-clip-id]').first();
	let properties = await openClipProperties(page, editor, clip, { additional: false });
	await setClipGain(properties, -20);
	const pitch = properties.getByRole('textbox', { name: 'Pitch', exact: true });
	await pitch.fill('12'); await pitch.press('Enter'); await expect(pitch).toHaveValue('12');
	await closeClipProperties(properties);
	if (warmed) await exportSamples(page, editor);
	await clip.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Normalize to −1 dBFS', exact: true }).click();
	properties = await openClipProperties(page, editor, clip, { additional: false });
	await expect.poll(() => readClipGain(properties)).toBeGreaterThan(0);
	await closeClipProperties(properties);
	const samples = await exportSamples(page, editor);
	const peak = samples.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0);
	expect(20 * Math.log10(peak)).toBeCloseTo(-1, 1);
});
