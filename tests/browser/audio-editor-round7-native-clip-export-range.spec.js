/* SPDX-License-Identifier: AGPL-3.0-only */

import { rm } from 'node:fs/promises';
import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseExportProjectFileAction, chooseFileAction, chooseNestedCommandAction, clipByName,
	closeClipProperties, closeDialog, commitInput, disableNativeSavePicker, downloadBytes, importFiles, openClipProperties,
	openExportDialog, readDownloadBytes, showClipTimingFields, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { setClipTimeFrames } from './audio-editor-clip-timing-test-helpers.js';
import { readWavePcm } from '../helpers/read-wave-pcm.ts';

test('Export clip defaults to the clicked range in a reopened archive', async ({ page }, result) => {
	await exportReopenedClip(page, result);
});

test('Export clip defaults to the clicked range in a read-only reopened archive', async ({ page, context }, result) => {
	await exportReopenedClip(page, result, async editor => {
		const peer = await context.newPage();
		await disableNativeSavePicker(peer);
		await peer.goto(page.url());
		const peerEditor = await waitForEditor(peer);
		await waitForProjectActivation(peerEditor);
		await expect(peerEditor).toHaveAttribute('data-project-id', await editor.getAttribute('data-project-id'));
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		await page.bringToFront();
	});
});

async function exportReopenedClip(page, result, prepareReadOnly = null) {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	const naming = page.getByRole('dialog', { name: 'Rename project', exact: true });
	await commitInput(naming.getByRole('textbox', { name: 'Project name', exact: true }), 'Two interviews');
	await naming.getByRole('button', { name: 'Save name', exact: true }).click();
	await expect(naming).toBeHidden();
	await importFiles(editor, [toneA, toneB]);
	const clip = clipByName(editor, toneB.name);
	const properties = await openClipProperties(page, editor, clip);
	await showClipTimingFields(properties);
	await setClipTimeFrames(properties, 'startFrame', 96_000);
	await closeClipProperties(properties);
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const download = await downloading;
	const archivePath = result.outputPath(download.suggestedFilename());
	try {
		await download.saveAs(archivePath);
		await download.delete();
		await editor.getByRole('button', { name: 'Close project: Two interviews', exact: true }).click();
		await expect(editor.getByRole('tab', { name: 'Two interviews', exact: true })).toHaveCount(0);
		await waitForProjectActivation(editor);
		const choosing = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await choosing).setFiles(archivePath);
		await expect(editor.getByRole('tab', { name: 'Two interviews', exact: true })).toHaveAttribute('aria-selected', 'true');
		await waitForProjectActivation(editor);
		await prepareReadOnly?.(editor);

		await clip.getByRole('button', { name: 'Clip menu', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Export clip', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Export audio', exact: true });
		await expect.soft(dialog.getByRole('button', { name: 'Output: Current selection', exact: true })).toBeVisible({ timeout: 2_000 });
		await expect.soft(editor.locator('[data-editor-toast="workspace-error"]')).toHaveCount(0);
		const clipped = await downloadWavePcm(page, dialog);
		expect(clipped.sampleRate).toBe(48_000);
		const [samples] = clipped.channels;
		expect.soft(samples).toHaveLength(38_400);
		const window = samples.subarray(4_800, 9_600);
		const requestedTone = toneMagnitude(window, clipped.sampleRate, 660);
		expect.soft(requestedTone).toBeGreaterThan(100);
		expect.soft(requestedTone).toBeGreaterThan(50 * toneMagnitude(window, clipped.sampleRate, 330));
		await closeDialog(dialog);
		const full = await openExportDialog(page, editor);
		await expect(full.getByRole('button', { name: 'Output: Entire project', exact: true })).toBeVisible();
		expect((await downloadWavePcm(page, full)).channels[0]).toHaveLength(134_400);
		if (prepareReadOnly) await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
	} finally {
		await rm(archivePath, { force: true });
	}
}

async function downloadWavePcm(page, dialog) {
	const downloading = page.waitForEvent('download', download => download.suggestedFilename().endsWith('.wav'));
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = await downloading;
	try { return readWavePcm(await downloadBytes(download)); }
	finally { await download.delete(); }
}

function toneMagnitude(samples, sampleRate, frequency) {
	let real = 0, imaginary = 0;
	for (const [index, sample] of samples.entries()) {
		const phase = 2 * Math.PI * index * frequency / sampleRate;
		real += sample * Math.cos(phase);
		imaginary += sample * Math.sin(phase);
	}
	return Math.hypot(real, imaginary);
}

test('clip export uses the exact authored range of an ordinary native Title', async ({ page }) => {
	// CI coverage reaches the second decoded delivery at the former 30-second limit.
	test.setTimeout(120_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [toneA]);
	const recording = clipByName(editor, toneA.name);
	await recording.locator('.clip-header').click({ button: 'right' });
	const exportClip = page.getByRole('menuitem', { name: 'Export clip', exact: true });
	await expect(exportClip).toBeVisible();
	await exportClip.click();
	const dialog = page.getByRole('dialog', { name: /Export/u });
	await expect(dialog).toBeVisible();
	await expect(page.locator('[data-editor-toast="workspace-error"], [data-editor-toast="workspace-status-error"]')).toHaveCount(0);
	expect(await deliveredFrames(page, dialog)).toBe(38_400);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
	const title = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	await title.locator('.clip-header').click({ button: 'right' });
	await expect(exportClip).toBeVisible();
	await exportClip.click();
	await expect(dialog).toBeVisible();
	await expect(page.locator('[data-editor-toast="workspace-error"], [data-editor-toast="workspace-status-error"]')).toHaveCount(0);
	expect(await deliveredFrames(page, dialog)).toBe(240_000);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
});

async function deliveredFrames(page, dialog) {
	await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), 'Current selection');
	await dialog.getByRole('checkbox', { name: /^Include effect tails/u }).uncheck();
	const link = dialog.locator('[data-export-download]');
	const previous = await link.getAttribute('href');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(link).toBeVisible({ timeout: 20_000 });
	await expect(link).not.toHaveAttribute('href', previous ?? '');
	const bytes = await readDownloadBytes(page, link);
	return page.evaluate(async data => {
		const context = new OfflineAudioContext(2, 1, 48_000);
		const decoded = await context.decodeAudioData(Uint8Array.from(data).buffer);
		return decoded.length;
	}, Array.from(bytes));
}
