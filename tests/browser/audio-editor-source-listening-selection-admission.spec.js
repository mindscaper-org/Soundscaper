/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openSourceMonitor, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

registerAudioEditorHooks();

test('locking a track preserves source listening-range selection while protecting its media', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const file = createWavFixture({ name: 'source-listening-range.wav', frequency: 440, duration: 2, channelCount: 1 });
	await importFiles(editor, [file]);
	const clip = clipByName(editor, file.name), row = clip.locator('xpath=ancestor::div[@data-track-row]');
	const panel = await openSourceMonitor(page, editor, clip);
	const waveform = panel.getByRole('region', { name: 'Source waveform', exact: true });
	const selectQuarter = async () => {
		const box = await waveform.boundingBox();
		if (!box) throw new Error('Expected the visible source waveform.');
		await page.mouse.move(box.x + box.width * 0.25, box.y + 70);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * 0.5, box.y + 70, { steps: 5 });
		await page.mouse.up();
	};
	const auditionEnd = async () => {
		await panel.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(panel.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		return Number(await panel.getByRole('slider', { name: 'Source timeline', exact: true }).getAttribute('aria-valuenow'));
	};
	await selectQuarter();
	await expect(waveform.locator('.audio-editor-source-selection')).toBeVisible();
	expect(await auditionEnd()).toBeCloseTo(1, 1);
	await chooseTrackMenuAction(page, editor, row, 'Lock track');
	await expect(panel.getByRole('button', { name: 'Trim source start', exact: true })).toBeDisabled();
	await expect(panel.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
	await waveform.click({ button: 'right', position: { x: 100, y: 70 } });
	await page.getByRole('menuitem', { name: 'All', exact: true }).click();
	const all = await waveform.locator('.audio-editor-source-selection').boundingBox();
	if (!all) throw new Error('Expected the offered All action to select the source.');
	await selectQuarter();
	await expect.poll(async () => (await waveform.locator('.audio-editor-source-selection').boundingBox())?.width ?? 0)
		.toBeCloseTo(all.width / 4, 0);
	expect(await auditionEnd()).toBeCloseTo(1, 1);
	await expect(panel.getByRole('button', { name: 'Trim source start', exact: true })).toBeDisabled();
});
