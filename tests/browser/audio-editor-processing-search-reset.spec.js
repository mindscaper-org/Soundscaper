/* SPDX-License-Identifier: AGPL-3.0-only */

import { installDesktopSpeedWarmupManifest } from './helpers/desktop-speed-warmup-fixture.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('Model Manager names its search reset button for assistive technology', async ({ page }) => {
	await installDesktopSpeedWarmupManifest(page);
	await page.addInitScript(() => {
	Object.defineProperty(globalThis, 'soundscaperDesktop', { configurable: true, value: { v1: {
	getEnvironment: async () => null, signalReady: async () => undefined, setLocale: async () => undefined,
	onMenuCommand: () => () => undefined, onOpenProject: () => () => undefined,
	onCloseRequested: () => () => undefined, onWindowStateChanged: () => () => undefined,
	listAssistanceModels: async () => ({ runtimeAvailable: true, runtimeReason: null, models: [] }),
	listAssistanceModelNotices: async () => [], onAssistanceInstallProgress: () => () => undefined,
	} } });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Model Manager');
	const manager = page.getByRole('dialog', { name: 'Model Manager', exact: true });
	const search = manager.getByRole('textbox', { name: 'Search models', exact: true });
	await search.fill('DeepFilterNet');
	const reset = manager.locator('.search-field__clear');
	await expect(reset).toHaveAccessibleName(/\S/);
	await search.press('Tab');
	await expect(reset).toBeFocused();
	await reset.press('Enter');
	await expect(search).toHaveValue('');
	await expect(search).toBeFocused();
});
