/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, readFile, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles, disableNativeSavePicker } from './audio-editor-test-helpers.js';

test('Plot spectrum displays the measured peak of a high-frequency tone', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'high-tone.wav', frequency: 10_000,
		duration: 0.8, channelCount: 2 })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Analyze', 'Plot spectrum');
	const dialog = page.getByRole('dialog', { name: 'Plot spectrum', exact: true });
	await expect(dialog.locator('[data-analysis-report="spectrum"]')).toBeVisible();
	const downloadPromise = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = await downloadPromise;
	const path = await download.path();
	if (!path) throw new Error('Missing exported spectrum report');
	const report = JSON.parse(await readFile(path, 'utf8')).report;
	expect(Math.abs(report.peak.frequency - 10_000)).toBeLessThan(25);
	const points = await dialog.locator('[data-analysis-spectrum] polyline').getAttribute('points');
	const plottedPeakDb = -Math.min(...points.split(' ').map((point) => Number(point.split(',')[1]))) / 150 * 120;
	expect(Math.abs(plottedPeakDb - report.peak.db)).toBeLessThan(1);
});

test('Plot spectrum overlays selected tracks with their own frequencies and track colors', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const files = [createWavFixture({ name: 'Bass.wav', frequency: 750 }),
		createWavFixture({ name: 'Lead.wav', frequency: 6000 }),
		createWavFixture({ name: 'Excluded.wav', frequency: 3000 })];
	await importFiles(editor, files);
	const bass = clipByName(editor, files[0].name);
	const lead = clipByName(editor, files[1].name);
	const leadTrack = lead.locator('xpath=ancestor::*[@data-track-row][1]');
	await leadTrack.getByRole('button', { name: 'Track menu', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Track color', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Track color: Orange', exact: true }).click();
	// Drag a time selection across only the first two populated tracks.
	const start = await bass.boundingBox();
	const end = await lead.boundingBox();
	if (!start || !end) throw new Error('Missing track geometry for spectrum selection');
	await page.mouse.move(start.x + 30, start.y + start.height * 0.7);
	await page.mouse.down();
	await page.mouse.move(end.x + 90, end.y + end.height * 0.7, { steps: 6 });
	await page.mouse.up();
	await chooseCommandAction(page, editor, 'Analyze', 'Plot spectrum');
	const dialog = page.getByRole('dialog', { name: 'Plot spectrum', exact: true });
	const plot = dialog.getByRole('img', { name: 'Plot spectrum', exact: true });
	const bassCurve = plot.locator('polyline').filter({ has: page.locator('title', { hasText: /^Bass$/ }) });
	const leadCurve = plot.locator('polyline').filter({ has: page.locator('title', { hasText: /^Lead$/ }) });
	await expect(plot.locator('polyline')).toHaveCount(2);
	await expect(bassCurve).toHaveCount(1);
	await expect(leadCurve).toHaveCount(1);
	const orange = await leadTrack.evaluate(row => {
		const swatch = document.createElement('span');
		swatch.style.color = getComputedStyle(row).getPropertyValue('--clip-orange-header');
		return swatch.style.color;
	});
	await expect(leadCurve).toHaveCSS('stroke', orange);
	const strokes = await plot.locator('polyline').evaluateAll(curves => curves.map(curve => getComputedStyle(curve).stroke));
	expect(strokes[0]).not.toBe(strokes[1]);
	await expect(dialog.getByRole('listitem').filter({ hasText: /^Bass/ })).toContainText('750.0 Hz');
	await expect(dialog.getByRole('listitem').filter({ hasText: /^Lead/ })).toContainText('6000.0 Hz');
	const downloadPromise = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const path = await (await downloadPromise).path();
	if (!path) throw new Error('Missing exported spectrum report');
	const report = JSON.parse(await readFile(path, 'utf8')).report;
	expect(report.tracks.map(track => [track.name, track.color, track.peak.frequency]))
		.toEqual([['Bass', 'blue', 750], ['Lead', 'orange', 6000]]);
	for (const track of report.tracks) {
		const curve = track.name === 'Bass' ? bassCurve : leadCurve;
		const points = await curve.getAttribute('points');
		const peakDb = -Math.min(...points.split(' ').map(point => Number(point.split(',')[1]))) / 150 * 120;
		expect(Math.abs(peakDb - track.peak.db)).toBeLessThan(1);
	}
});
