/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';

for (const mode of ['natural end', 'pause']) test(`source monitor Play resumes after ${mode}`, async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__sourceReplayEvents = [];
		for (const name of ['play', 'ended']) document.addEventListener(name, event => {
			if (event.target instanceof HTMLVideoElement && event.target.hasAttribute('data-source-monitor-video')) {
				globalThis.__sourceReplayEvents.push({ name, time: event.target.currentTime });
			}
		}, true);
	});
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const fixture = videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1');
	await editor.locator('[data-project-bin-input]').setInputFiles(fixture.file);
	await editor.locator('[data-bin-action="source-monitor"]').first().click();
	const monitor = editor.locator('[data-source-monitor]');
	const video = monitor.locator('[data-source-monitor-video]');
	await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2);
	await monitor.getByRole('button', { name: 'Play', exact: true }).click();
	let pausedAt = 0;
	if (mode === 'natural end') {
		await expect.poll(() => page.evaluate(() => globalThis.__sourceReplayEvents.filter(event => event.name === 'ended').length)).toBe(1);
		await expect(monitor).toHaveAttribute('data-source-monitor-frame', String(fixture.presentationTicks.length - 1));
	} else {
		await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(.2);
		await monitor.getByRole('button', { name: 'Pause', exact: true }).click();
		pausedAt = await video.evaluate(element => element.currentTime);
		expect(pausedAt).toBeGreaterThan(.15);
	}
	await monitor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__sourceReplayEvents.filter(event => event.name === 'play').length)).toBe(2);
	const replay = await page.evaluate(() => globalThis.__sourceReplayEvents.filter(event => event.name === 'play').at(-1).time);
	if (mode === 'natural end') expect(replay).toBeLessThan(1 / 25);
	else expect(Math.abs(replay - pausedAt)).toBeLessThanOrEqual(1 / 25);
});
