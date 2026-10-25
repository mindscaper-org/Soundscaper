/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, chooseDropdown, closeDialog, openExportDialog, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { installLinkedAudioBridge } from './helpers/linked-audio-relink-fixture.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';

for (const unavailable of [false, true]) test(`Recover preserves healthy media beside a ${unavailable ? 'missing' : 'present'} external WAV`, async ({ page, context }) => {
	test.setTimeout(90_000);
	await installLinkedAudioBridge(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(toneB);
	await editor.locator('[data-project-bin-item]').first().getByRole('button', { name: /Add to timeline/u }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	let reference = await exportPcm(page, editor);
	await editor.getByRole('button', { name: 'Link WAV', exact: true }).click();
	await editor.locator('[data-project-bin-item]').nth(1).getByRole('button', { name: /Add to timeline/u }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	if (!unavailable) reference = await exportPcm(page, editor);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const originalId = await editor.getAttribute('data-project-id'), url = page.url();
	const original = await persistedProject(page, originalId);
	await page.close();
	const reopened = await context.newPage();
	await installLinkedAudioBridge(reopened, { original: toneA, changed: toneB }, { unavailable });
	await reopened.goto(url);
	const active = await waitForEditor(reopened);
	await expect(active).toHaveAttribute('data-project-id', originalId); await waitForProjectActivation(active);
	await chooseCommandAction(reopened, active, 'File', 'New'); await expect(active).not.toHaveAttribute('data-project-id', originalId);
	await waitForProjectActivation(active);
	await chooseNestedCommandAction(reopened, active, 'File', ['Project management', 'Recover a project']);
	const dialog = reopened.getByRole('dialog', { name: 'Project recovery', exact: true }); await expect(dialog).toBeVisible();
	await dialog.getByLabel('Project to recover').selectOption(originalId);
	await expect(dialog.getByLabel('Saved version').locator('option').first()).toContainText(unavailable ? 'Needs repair' : 'Ready to recover');
	await dialog.getByRole('button', { name: 'Recover as a new project' }).click(); await expect(dialog).toBeHidden();
	await expect(active).toHaveAttribute('data-clip-count', unavailable ? '1' : '2'); await waitForProjectActivation(active);
	await expect(active.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const copyId = await active.getAttribute('data-project-id'); expect(copyId).not.toBe(originalId);
	const copy = await persistedProject(reopened, copyId);
	expect(copy.sources.map(source => source.name)).toEqual(unavailable ? [toneB.name] : original.sources.map(source => source.name));
	expect(await persistedProject(reopened, originalId)).toEqual(original);
	const bytes = await exportPcm(reopened, active);
	const descriptor = await inspectWavBlobPcm(new Blob([bytes])); expect(descriptor.frameCount).toBe(38_400);
	const originalPcm = await inspectWavBlobPcm(new Blob([reference]));
	expect(descriptor.channelCount).toBe(originalPcm.channelCount);
	const expected = new DataView(reference.buffer), actual = new DataView(bytes.buffer);
	let error = 0;
	for (let frame = 0; frame < descriptor.frameCount; frame++) for (let channel = 0; channel < descriptor.channelCount; channel++) {
		error = Math.max(error, Math.abs(actual.getFloat32(descriptor.dataOffset + frame * descriptor.blockAlign + channel * 4, true)
			- expected.getFloat32(originalPcm.dataOffset + frame * originalPcm.blockAlign + channel * 4, true)));
	}
	expect(error).toBe(0);
	await reopened.close();
});

async function exportPcm(page, editor) {
	const count = await page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '32-bit Float');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length), { timeout: 15_000 }).toBe(count + 1);
	await closeDialog(dialog);
	return Uint8Array.from(await page.evaluate(() => Array.from(globalThis.__projectBinLinkedAudioFixture.exports.at(-1))));
}
