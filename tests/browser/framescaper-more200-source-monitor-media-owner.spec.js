/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, stubStorageEstimate } from './audio-editor-test-helpers.js';
import { videoPreviewBenchmarkMedia } from './fixtures/video-preview-benchmark-media.js';

test('changing verified proxy media stops and repositions the source monitor transport', async ({ page }) => {
	test.setTimeout(120_000);
	await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
	await page.addInitScript(() => {
		Object.defineProperty(navigator.storage, 'persisted', { configurable: true, value: async () => true });
	});
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const original = videoPreviewBenchmarkMedia.file;
	await editor.locator('[data-project-bin-input]').setInputFiles(original);
	const card = editor.locator('[data-project-bin-item]').first();
	await expect(card).toBeVisible();
	await card.locator('[data-bin-action="source-monitor"]').click();
	const monitor = editor.locator('[data-source-monitor]');
	const video = monitor.locator('video');
	await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThan(1);
	await card.getByRole('button', { name: /More file actions:/u }).click();
	await page.getByRole('menuitem', { name: 'Video proxies', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Video proxies', exact: true });
	const feedback = dialog.locator('.audio-editor-video-proxy > [role="status"]').last();
	const chooserPromise = page.waitForEvent('filechooser');
	await dialog.getByRole('button', { name: 'Attach existing', exact: true }).click();
	await (await chooserPromise).setFiles({ ...original, name: 'verified-editorial-proxy.webm' });
	await expect(feedback).toContainText('Existing proxy validated and attached.', { timeout: 30_000 });
	await dialog.getByRole('combobox', { name: 'Preview media', exact: true }).selectOption('original');
	await expect(feedback).toContainText('Preview mode updated and proxy trust refreshed.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThan(1);
	const originalUrl = await video.getAttribute('src');
	await monitor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(0.1);
	await card.getByRole('button', { name: /More file actions:/u }).click();
	await page.getByRole('menuitem', { name: 'Video proxies', exact: true }).click();
	expect(await video.evaluate(element => element.ended)).toBe(false, 'mode changes during an ordinary active source audition');
	await dialog.getByRole('combobox', { name: 'Preview media', exact: true }).selectOption('proxy');
	await expect(feedback).toContainText('Preview mode updated and proxy trust refreshed.');
	await expect(video).not.toHaveAttribute('src', originalUrl);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThan(1);
	expect(await video.evaluate(element => element.paused)).toBe(true);
	await expect(monitor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	const stoppedTime = await video.evaluate(element => element.currentTime);
	await monitor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => video.evaluate(element => element.paused)).toBe(false);
	await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(stoppedTime + 0.1);
	await monitor.getByRole('button', { name: 'Pause', exact: true }).click();
});
