/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { openInstalledGain } from './helpers/native-plugin-parameter-host.js';

test('Audio Plugins generated controls leave room in the native audio request queue', async ({ page }) => {
	const dialog = await openInstalledGain(page, { parameterCount: 32, holdParameterReads: true });
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.requests.filter(kind => kind === 'parameter-get').length)).toBeGreaterThan(0);
	expect(await page.evaluate(() => globalThis.__nativePluginParameterHost.requests.filter(kind => kind === 'parameter-get').length)).toBe(1);
	await page.evaluate(() => globalThis.__nativePluginParameterHost.releaseParameterReads());
	await expect(dialog.locator('[data-native-plugin-parameter]')).toHaveCount(32);
});
