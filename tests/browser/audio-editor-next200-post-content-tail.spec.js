/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, chooseDropdown, closeDialog, commitInput,
	disableNativeSavePicker, importFiles, openEffectsForTrack, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';

test('a selected export after the final clip captures the echoes at its authored time', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Short recording.wav', duration: .2,
		frequency: 500, channelCount: 1, channelAmplitudes: [.05] })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const panel = await openEffectsForTrack(editor, 1); await addRackEffect(page, panel, 'track', 'Delay');
	const delay = page.getByRole('dialog', { name: 'Delay', exact: true });
	for (const [parameter, value] of [['time', '1'], ['echoes', '2'], ['echoGain', '0']]) {
		await commitInput(delay.locator(`[data-effect-param="${parameter}"] input[type="number"]`), value);
	}
	await closeDialog(delay);
	const full = await wave(page, editor, false);
	for (const [start, end] of [[.05, .15], [1.05, 1.15]]) {
		await setTime(editor, 'Selection end', end); await setTime(editor, 'Selection start', start);
		const selected = await wave(page, editor, true);
		expect(selected.descriptor.frameCount).toBe(4800);
		let error = 0, energy = 0;
		for (let frame = 0; frame < 4800; frame++) for (let channel = 0; channel < 2; channel++) {
			const reference = full.data.getFloat32(full.descriptor.dataOffset + (Math.round(start * 48_000) + frame) * full.descriptor.blockAlign + channel * 4, true);
			const actual = selected.data.getFloat32(selected.descriptor.dataOffset + frame * selected.descriptor.blockAlign + channel * 4, true);
			error = Math.max(error, Math.abs(actual - reference)); energy += reference ** 2;
		}
		expect(Math.sqrt(energy / 9600)).toBeGreaterThan(.01);
		expect(error, `selection ${start}..${end}`).toBeLessThan(1e-6);
	}
});

async function setTime(editor, name, value) {
	const control = editor.getByRole('group', { name, exact: true });
	await control.locator('.timecode__display').dblclick();
	await control.locator('input').fill(String(value)); await control.locator('input').press('Enter');
}

async function wave(page, editor, selection) {
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), selection ? 'Current selection' : 'Entire project');
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '32-bit Float');
	await dialog.getByRole('checkbox', { name: /^Include effect tails/u }).setChecked(!selection);
	const link = dialog.locator('[data-export-download]'), previous = await link.getAttribute('href');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(link).toBeVisible({ timeout: 15_000 }); await expect(link).not.toHaveAttribute('href', previous ?? '');
	const bytes = await readDownloadBytes(page, link), descriptor = await inspectWavBlobPcm(new Blob([bytes]));
	await closeDialog(dialog);
	return { descriptor, data: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
}
