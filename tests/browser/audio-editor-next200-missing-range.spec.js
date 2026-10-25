/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, clipByName, clipField, closeClipProperties, closeDialog, commitInput, openClipProperties, openExportDialog, showClipTimingFields, waitForEditor } from './audio-editor-test-helpers.js';
import { installLinkedAudioBridge } from './helpers/linked-audio-relink-fixture.js';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';

for (const unavailable of [false, true]) test(`selection before a ${unavailable ? 'missing' : 'healthy'} linked original exports its healthy audio`, async ({ page, context }) => {
	test.setTimeout(60_000);
	await installLinkedAudioBridge(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(toneB);
	await editor.locator('[data-project-bin-item]').nth(0).getByRole('button', { name: /Add to timeline/u }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await editor.getByRole('button', { name: 'Link WAV', exact: true }).click();
	await editor.locator('[data-project-bin-item]').nth(1).getByRole('button', { name: /Add to timeline/u }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	const timing = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	await showClipTimingFields(timing);
	await commitInput(clipField(timing, 'startFrame'), '48000');
	await closeClipProperties(timing);
	const healthy = clipByName(editor, toneB.name); await healthy.focus(); await healthy.press('Enter');
	const originalDialog = await startSelectionExport(page, editor);
	await expect.poll(() => page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length)).toBe(1);
	const original = Uint8Array.from(await page.evaluate(() => Array.from(globalThis.__projectBinLinkedAudioFixture.exports[0])));
	await closeDialog(originalDialog);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const id = await editor.getAttribute('data-project-id'), url = page.url();
	await page.close();
	const reopened = await context.newPage();
	await installLinkedAudioBridge(reopened, { original: toneA, changed: toneB }, { unavailable });
	await reopened.goto(url);
	const active = await waitForEditor(reopened);
	await expect(active).toHaveAttribute('data-project-id', id);
	await expect(active).not.toHaveAttribute('data-project-activation-pending', 'true');
	const selected = clipByName(active, toneB.name); await selected.focus(); await selected.press('Enter');
	const dialog = await startSelectionExport(reopened, active);
	await expect.poll(() => reopened.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length), { timeout: 15_000 }).toBe(1);
	const bytes = Uint8Array.from(await reopened.evaluate(() => Array.from(globalThis.__projectBinLinkedAudioFixture.exports[0])));
	const descriptor = await inspectWavBlobPcm(new Blob([bytes]));
	expect(descriptor.frameCount).toBe(38_400); expect(descriptor.sampleRate).toBe(48_000);
	const data = new DataView(bytes.buffer); let energy = 0;
	for (let frame = 1000; frame < 37000; frame++) energy += data.getFloat32(descriptor.dataOffset + frame * descriptor.blockAlign, true) ** 2;
	expect(Math.sqrt(energy / 36000)).toBeGreaterThan(.05);
	const reference = await inspectWavBlobPcm(new Blob([original])), referenceData = new DataView(original.buffer);
	expect(descriptor.channelCount).toBe(reference.channelCount);
	let error = 0;
	for (let frame = 0; frame < descriptor.frameCount; frame++) for (let channel = 0; channel < descriptor.channelCount; channel++) {
		error = Math.max(error, Math.abs(data.getFloat32(descriptor.dataOffset + frame * descriptor.blockAlign + channel * 4, true)
			- referenceData.getFloat32(reference.dataOffset + frame * reference.blockAlign + channel * 4, true)));
	}
	expect(error).toBe(0);
	if (unavailable) {
		await closeDialog(dialog);
		const missing = clipByName(active, toneA.name); await missing.focus(); await missing.press('Enter');
		const refused = await startSelectionExport(reopened, active);
		await expect(refused.getByRole('alert')).toContainText('Local audio sources are missing.');
		expect(await reopened.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length)).toBe(1);
	}
	await reopened.close();
});

async function startSelectionExport(page, editor) {
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), 'Current selection');
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '32-bit Float');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	return dialog;
}
