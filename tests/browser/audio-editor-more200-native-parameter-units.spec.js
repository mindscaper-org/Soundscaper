/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { openInstalledGain } from './helpers/native-plugin-parameter-host.js';

test('installed plug-in parameter readouts describe positions without inventing decibels', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'The native plug-in desktop host runs in Electron Chromium.');
	const dialog = await openInstalledGain(page, { parameterLabel: 'dB' });
	const range = dialog.locator('[data-native-plugin-parameter="gain"]');
	await expect(range).toHaveValue('0.25');
	await expect(dialog.locator('[data-native-plugin-parameter-controls] output')).toHaveText('25%');
	await expect(range).toHaveAttribute('aria-valuetext', '25%');
	await range.press('Home');
	await expect.poll(() => page.evaluate(() => globalThis.__nativePluginParameterHost.values[0])).toBe(0);
	await expect(dialog.locator('[data-native-plugin-parameter-controls] output')).toHaveText('0%');
});
