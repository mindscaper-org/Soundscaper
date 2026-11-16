/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import {
	addRackEffect, bootEditor, chooseCommandAction, chooseDropdown, chooseNestedCommandAction,
	closeDialog, closeEffectsPanel, disableNativeSavePicker, importFiles, openEffectsForTrack,
	openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';
import { readWavePcm } from '../helpers/read-wave-pcm.ts';

test('In/Out export wraps a delay into the beginning only when Render as loop is enabled', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const source = createWavFixture({ name: 'loop-tail.wav', frequency: 440, duration: .8, channelCount: 1 });
	// Only the last .2 seconds contain input; the delayed signal crosses Out.
	source.buffer.fill(0, 44, 44 + 28_800 * 2);
	await importFiles(editor, [source]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Select', ['Loop region', 'Set loop to selection']);
	const effects = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, effects, 'track', 'Delay');
	await closeDialog(page.getByRole('dialog', { name: 'Delay', exact: true }));
	await closeEffectsPanel(effects);
	const dialog = await openExportDialog(page, editor);
	await expect(dialog.getByRole('checkbox', { name: 'Include effect tails up to 10 seconds', exact: true })).not.toBeChecked();
	await expect(dialog.getByRole('group', { name: 'Dither', exact: true })).toContainText('None');
	await expect(dialog.getByRole('checkbox', { name: 'Render as loop', exact: true })).toHaveCount(0);
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Output', exact: true }), 'In/Out (looping region)');
	const loop = dialog.getByRole('checkbox', { name: 'Render as loop', exact: true });
	await expect(loop).not.toBeChecked();
	await dialog.getByRole('button', { name: 'Help: Render as loop', exact: true }).hover();
	await expect(page.getByRole('tooltip')).toHaveText('Adds effect tails (like reverb) to the beginning of the loop to blend between the ends seamlessly');
	await dialog.getByRole('heading', { name: 'Rendering', exact: true }).hover();
	const first = await exportLoop();
	await loop.click();
	await expect(dialog.getByRole('checkbox', { name: 'Include effect tails up to 10 seconds', exact: true })).toBeDisabled();
	const wrapped = await exportLoop();
	expect(first.channels[0]).toHaveLength(38_400);
	expect(wrapped.channels[0]).toHaveLength(38_400);
	const peak = channels => Math.max(...channels[0].slice(0, 9600).map(Math.abs));
	expect(peak(first.channels)).toBeLessThan(.00001);
	expect(peak(wrapped.channels)).toBeGreaterThan(.01);
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Output', exact: true }), 'Entire project');
	await expect(loop).toHaveCount(0);

	async function exportLoop() {
		const download = dialog.locator('[data-export-download]');
		const previous = await download.count() ? await download.getAttribute('href') : null;
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		await expect(download).toBeVisible({ timeout: 20_000 });
		await expect.poll(() => download.getAttribute('href')).not.toBe(previous);
		return readWavePcm(await readDownloadBytes(page, download));
	}
});
