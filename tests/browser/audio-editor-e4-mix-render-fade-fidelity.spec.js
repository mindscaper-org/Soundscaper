/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, closeDialog,
	commitInput, disableNativeSavePicker, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const [mixDown, microfades] of [[true, true], [false, false]]) test(`${mixDown ? 'Combined' : 'Individual'} print preserves recorded endpoints with new-clip fades ${microfades}`, async ({ page }) => {
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	{
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Editing$/u }).click();
		const setting = preferences.getByRole('checkbox', { name: 'Apply 2 ms fades to new clips' });
		await expect(setting).toBeChecked();
		if (!microfades) await setting.uncheck();
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	}
	const recording = createWavFixture({ name: 'Recording.wav', duration: .25, frequency: 1000, channelCount: 2, channelAmplitudes: [.25, .25] });
	await importFiles(editor, [recording]);
	if (!mixDown) {
		const properties = await openClipProperties(page, editor, clipByName(editor, recording.name));
		await properties.getByText('Effects', { exact: true }).click();
		await addRackEffect(page, properties, 'track', 'Feedback delay');
		const delay = page.getByRole('dialog', { name: 'Feedback delay', exact: true });
		for (const [parameter, value] of Object.entries({ time: '0.05', feedback: '0', mix: '1' })) {
			await commitInput(delay.locator(`[data-effect-param="${parameter}"] input`), value);
		}
		await closeDialog(delay);
	}
	await clipByName(editor, recording.name).locator('.clip-header').click();
	const before = await exportSamples(page, editor, { includeTail: true });
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Mix & Render']);
	const dialog = page.getByRole('dialog', { name: 'Mix & Render', exact: true });
	if (!mixDown) await dialog.getByRole('checkbox', { name: 'Mix down', exact: true }).click();
	await dialog.getByRole('button', { name: 'Mix & Render', exact: true }).click(); await expect(dialog).toBeHidden();
	const after = await exportSamples(page, editor, { includeTail: true });
	expect(after).toHaveLength(before.length);
	const error = after.reduce((maximum, value, frame) => Math.max(maximum, Math.abs(value - before[frame])), 0);
	console.log('baked endpoint comparison', { mixDown, microfades, error });
	expect(error).toBeLessThan(.0001);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const undone = await exportSamples(page, editor, { includeTail: true });
	expect(undone.reduce((maximum, value, frame) => Math.max(maximum, Math.abs(value - before[frame])), 0)).toBeLessThan(.0001);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	const redone = await exportSamples(page, editor, { includeTail: true });
	expect(redone.reduce((maximum, value, frame) => Math.max(maximum, Math.abs(value - after[frame])), 0)).toBeLessThan(.0001);
});
