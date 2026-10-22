/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { videoPreviewBenchmarkMedia } from './fixtures/video-preview-benchmark-media.js';

test('source monitor position follows the playing source picture', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await expect(editor.getByRole('button', { name: 'Add media', exact: true }).first()).toBeEnabled();
	await editor.locator('[data-project-bin-input]').setInputFiles(videoPreviewBenchmarkMedia.file);
	const card = editor.locator('[data-project-bin-item]').first(); await expect(card).toBeVisible();
	await card.locator('[data-bin-action="source-monitor"]').click();
	const monitor = editor.locator('[data-source-monitor]');
	const video = monitor.locator('video');
	await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThan(1);
	await monitor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(.5);
	// Check while this six-second source is still playing: its ended handler
	// already updates the stopped position and must not mask a frozen readout.
	await expect(monitor).not.toHaveAttribute('data-source-monitor-frame', '0', { timeout: 500 });
	await expect(monitor.getByRole('slider')).not.toHaveValue('0');
	await monitor.getByRole('button', { name: 'Pause', exact: true }).click();
	await expect(monitor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});
