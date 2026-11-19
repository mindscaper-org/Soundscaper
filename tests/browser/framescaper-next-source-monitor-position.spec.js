/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { pausedIntraVideoFile } from './fixtures/video-paused-preview-media.js';
import { videoPreviewBenchmarkMedia } from './fixtures/video-preview-benchmark-media.js';

async function openSourceMonitor(page, file) {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await expect(editor.getByRole('button', { name: 'Add media', exact: true }).first()).toBeEnabled();
	await editor.locator('[data-project-bin-input]').setInputFiles(file);
	const card = editor.locator('[data-project-bin-item]').first(); await expect(card).toBeVisible();
	await card.locator('[data-bin-action="source-monitor"]').click();
	const monitor = editor.locator('[data-source-monitor]');
	const video = monitor.locator('video');
	await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThan(1);
	return { monitor, video };
}

test('source monitor position follows the playing source picture', async ({ page }) => {
	const { monitor, video } = await openSourceMonitor(page, videoPreviewBenchmarkMedia.file);
	await monitor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(.5);
	// Check while this six-second source is still playing: its ended handler
	// already updates the stopped position and must not mask a frozen readout.
	await expect(monitor).not.toHaveAttribute('data-source-monitor-frame', '0', { timeout: 500 });
	await expect(monitor.getByRole('slider')).not.toHaveValue('0');
	await monitor.getByRole('button', { name: 'Pause', exact: true }).click();
	await expect(monitor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('source monitor shows the indexed picture being marked', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'The all-intra H.264 witness targets Chromium picture selection.');
	const { monitor, video } = await openSourceMonitor(page, pausedIntraVideoFile);
	for (const [frame, expected] of [[1, [0, 1, 0]], [2, [0, 0, 1]], [3, [1, 1, 0]], [0, [1, 0, 0]]]) {
		await monitor.getByRole('slider').fill(String(frame));
		await expect(monitor).toHaveAttribute('data-source-monitor-frame', String(frame));
		await expect.poll(() => video.evaluate(element => {
			if (element.seeking || element.readyState < 2) return null;
			const canvas = document.createElement('canvas');
			canvas.width = element.videoWidth;
			canvas.height = element.videoHeight;
			const context = canvas.getContext('2d');
			context.drawImage(element, 0, 0);
			return [...context.getImageData(32, 32, 1, 1).data.slice(0, 3)].map(channel => Number(channel > 128));
		})).toEqual(expected);
	}
	await monitor.locator('[data-source-monitor-action="mark-in"]').click();
	await expect(monitor).toHaveAttribute('data-source-monitor-mark-in', '0');
});
