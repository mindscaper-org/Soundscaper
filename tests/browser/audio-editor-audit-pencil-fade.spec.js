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
	// Focusing the expanded fade can scroll the first stroke sample beneath
	// the sticky track controls. Reveal the clip start before measuring it.
	const timeline = editor.locator('[data-timeline]');
	await timeline.evaluate(element => { element.scrollLeft = 0; });
	await expect.poll(() => timeline.evaluate(element => element.scrollLeft)).toBe(0);
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
	expect(samples[48]).toBeCloseTo(samples[24], 5);
	expect(samples[72]).toBeCloseTo(samples[24], 5);
	// Curved AudioParam fades use an adaptive 0.001 gain error budget.
	// Exact gain knots stay flat; interpolated ramps retain that bounded error.
	for (let frame = 25; frame <= 72; frame++) expect(Math.abs(samples[frame] - samples[24])).toBeLessThan(0.0001);
});
