/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { installNativeOutputPeer } from './helpers/native-output-peer.js';

test('a replaced native recording-rate choice leaves the latest connected rate free of stale errors', async ({ page }) => {
	await installNativeOutputPeer(page);
	await page.addInitScript(() => {
		const originalClose = AudioContext.prototype.close;
		window.__recordingRateRetirement = { hold: false, blocked: false, finished: false, release: null };
		AudioContext.prototype.close = async function () {
			const held = window.__recordingRateRetirement.hold;
			if (held) {
				window.__recordingRateRetirement.hold = false;
				window.__recordingRateRetirement.blocked = true;
				await new Promise(resolve => { window.__recordingRateRetirement.release = resolve; });
			}
			await originalClose.call(this);
			if (held) window.__recordingRateRetirement.finished = true;
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	await setup.getByRole('combobox', { name: 'Host', exact: true }).selectOption('alsa');
	const rate = setup.getByRole('combobox', { name: 'Recording sample rate', exact: true });
	await expect(rate).toBeEnabled();
	await page.evaluate(() => { window.__recordingRateRetirement.hold = true; });
	await rate.selectOption('44100');
	await expect.poll(() => page.evaluate(() => window.__recordingRateRetirement.blocked)).toBe(true);
	await expect(rate).toBeEnabled();
	await rate.selectOption('96000');
	await expect(rate).toHaveValue('96000');
	await expect(rate).toBeEnabled();
	await page.evaluate(() => { window.__recordingRateRetirement.release(); });
	await expect.poll(() => page.evaluate(() => window.__recordingRateRetirement.finished)).toBe(true);
	// Drain the retired request's continuation and the workspace's React publication.
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	await expect(rate).toHaveValue('96000');
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
