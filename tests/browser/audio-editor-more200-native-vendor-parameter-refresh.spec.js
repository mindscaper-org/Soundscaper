/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { openInstalledGain } from './helpers/native-plugin-parameter-host.js';

test('closing the installed vendor editor shows its updated parameter values', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'The native plug-in desktop host runs in Electron Chromium.');
	const dialog = await openInstalledGain(page, { vendorUi: true });
	const range = dialog.locator('[data-native-plugin-parameter="gain"]');
	await expect(range).toHaveValue('0.25');
	await dialog.locator('[data-native-plugin-open-vendor-ui]').click();
	await expect(dialog.locator('[data-native-plugin-close-vendor-ui]')).toBeVisible();
	// The native window edits the isolated helper, outside the generated form.
	await page.evaluate(() => { globalThis.__nativePluginParameterHost.values[0] = .75; });
	await dialog.locator('[data-native-plugin-close-vendor-ui]').click();
	await expect(dialog.locator('[data-native-plugin-open-vendor-ui]')).toBeVisible();
	await expect(range).toHaveValue('0.75');
	await expect(dialog.locator('[data-native-plugin-parameter-controls] output')).toHaveText('75%');
});
