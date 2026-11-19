/* SPDX-License-Identifier: AGPL-3.0-only */

import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { installDesktopSpeedWarmupManifest } from './helpers/desktop-speed-warmup-fixture.js';

test('the FFmpeg preference reconnects to an installation already in progress', async ({ page }) => {
	await installDesktopBridge(page, true);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const panel = page.locator('[data-external-ffmpeg-preference]');
	await expect(panel).toHaveAttribute('data-external-ffmpeg-state', 'installing');
	await expect(panel.getByRole('button', { name: 'Rescan', exact: true })).toBeDisabled();
	await page.evaluate(() => { globalThis.externalFfmpegStillInstalling = false; });
	await expect(panel).toHaveAttribute('data-external-ffmpeg-state', 'ready');
	await expect(panel.getByRole('button', { name: 'Rescan', exact: true })).toBeEnabled();
});

test('a desktop bridge without optional FFmpeg operations still opens General preferences', async ({ page }) => {
	await installDesktopBridge(page, false);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const panel = page.locator('[data-external-ffmpeg-preference]');
	await expect(panel).toHaveAttribute('data-external-ffmpeg-state', 'unavailable');
	await expect(panel.getByRole('button', { name: 'Browse', exact: true })).toBeDisabled();
});

async function installDesktopBridge(page, hasFfmpegService) {
	await installDesktopSpeedWarmupManifest(page);
	await page.addInitScript((hasFfmpegService) => {
		globalThis.externalFfmpegStillInstalling = true;
		globalThis.soundscaperDesktop = { v1: {
			getEnvironment: async () => null,
			signalReady: () => undefined,
			onOpenProject: () => () => {}, onCloseRequested: () => () => {},
			onMenuCommand: () => () => {}, onWindowStateChanged: () => () => {},
			...(hasFfmpegService ? {
				getExternalFfmpegStatus: async () => globalThis.externalFfmpegStillInstalling
					? { state: 'installing' }
					: { state: 'ready', location: '/usr/bin/ffmpeg', version: '9.0.1', canBrowse: true },
				rescanExternalFfmpeg: async () => ({ state: 'ready' }),
			} : {}),
		} };
	}, hasFfmpegService);
}
