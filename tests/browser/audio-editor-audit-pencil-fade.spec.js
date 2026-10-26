/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, chooseNestedCommandAction, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('a horizontal Pencil stroke through a fade exports the drawn level between pointer observations', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'Pencil fade.wav', frequency: 1000, duration: .002, channelCount: 1 });
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Zoom to selection']);
	await expect(editor.getByRole('toolbar', { name: 'Sample tools', exact: true })).toBeVisible();
	const fade = clip.getByRole('slider', { name: 'Fade in', exact: true });
	await fade.press('End');
	await expect(fade).toHaveAttribute('aria-valuenow', '0.002');
	const geometry = await clip.evaluate(element => {
		const display = element.querySelector('.clip-display').getBoundingClientRect();
		const lane = element.closest('[data-track-lane]');
		const bounds = lane.getBoundingClientRect();
		const bodyTop = Number(lane.dataset.channelBodyTop);
		const y = bounds.y + bodyTop + (bounds.height - bodyTop) * .45;
		return { start: { x: display.x + 24.1 / 96 * display.width, y }, end: { x: display.x + 72.1 / 96 * display.width, y } };
	});
	await page.mouse.move(geometry.start.x, geometry.start.y);
	await page.mouse.down();
	await page.mouse.move(geometry.end.x, geometry.end.y, { steps: 1 });
	await page.mouse.up();
	await expect(editor.locator('[data-status]')).toHaveText('Edited samples.', { timeout: 20_000 });
	const samples = await exportSamples(page, editor);
	expect(samples[24]).toBeGreaterThan(0.05);
	for (let frame = 25; frame <= 72; frame++) expect(samples[frame]).toBeCloseTo(samples[24], 5);
});
