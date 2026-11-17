/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, clipField, closeClipProperties, closeDialog, commitInput, disableNativeSavePicker, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { chooseClipMediaSetting } from './audio-editor-clip-settings-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('Render pitch and speed preserves a clip delay exactly once', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'burst.wav', frequency: 1000, duration: 1, channelCount: 1 });
	recording.buffer.fill(0, 44);
	for (let frame = 24000; frame < 25000; frame++) recording.buffer.writeInt16LE(Math.round(Math.sin((frame - 24000) * Math.PI / 24) * 16000), 44 + frame * 2);
	await importFiles(editor, [recording]);
	const clip = editor.locator('[data-clip-id]').first();
	const properties = await openClipProperties(page, editor, clip);
	await chooseClipMediaSetting(properties, 'Link pitch and tempo');
	await commitInput(clipField(properties, 'speedRatio'), '200');
	await properties.getByText('Effects', { exact: true }).click();
	await addRackEffect(page, properties, 'track', 'Feedback delay');
	const delay = page.getByRole('dialog', { name: 'Feedback delay', exact: true });
	for (const [parameter, value] of [['mix', '1'], ['feedback', '0'], ['time', '.05']]) await commitInput(delay.locator(`[data-effect-param="${parameter}"] input`), value);
	await closeDialog(delay); await closeClipProperties(properties);
	const before = await exportSamples(page, editor, { includeTail: false });
	await clip.getByRole('button', { name: 'Clip menu', exact: true }).click();
	await page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: 'Render pitch and speed', exact: true }).click();
	await expect(editor.locator('[data-clip-id]').first()).toContainText('Render pitch and speed');
	const after = await exportSamples(page, editor, { includeTail: false });
	const onset = samples => samples.findIndex(sample => Math.abs(sample) > .01);
	expect(onset(before)).toBeGreaterThan(14000);
	expect(onset(after)).toBe(onset(before));
});
