/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, waitForEditor } from './audio-editor-test-helpers.js';
import { installDesktopSpeedWarmupManifest } from './helpers/desktop-speed-warmup-fixture.js';

for (const path of ['/embed/en/', '/framescaper/embed/en/']) {
	test(`desktop General update preference persists in ${path}`, async ({ page }) => {
		await installDesktopBridge(page, true);
		let editor = await bootEditor(page, path);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		const checkbox = dialog.getByRole('checkbox', { name: 'Check for updates', exact: true });
		await expect(checkbox).toBeChecked();
		await checkbox.click();
		await expect(checkbox).not.toBeChecked();
		await expect.poll(() => page.evaluate(() => localStorage.getItem('test-update-checks'))).toBe('false');
		await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
		await page.reload(); editor = await waitForEditor(page);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		await expect(checkbox).not.toBeChecked();
		await checkbox.click();
		await expect(checkbox).toBeChecked();
		await expect.poll(() => page.evaluate(() => localStorage.getItem('test-update-checks'))).toBe('true');
	});
	test(`portable General update preference is disabled in ${path}`, async ({ page }) => {
		await installDesktopBridge(page, false);
		const editor = await bootEditor(page, path);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const checkbox = page.getByRole('dialog', { name: 'Editor preferences', exact: true })
			.getByRole('checkbox', { name: 'Check for updates', exact: true });
		await expect(checkbox).toBeDisabled();
		await expect(checkbox).not.toBeChecked();
	});
	test(`managed launch preferences permit session changes and reset after relaunch in ${path}`, async ({ page }) => {
		await installDesktopBridge(page, false, true);
		let editor = await bootEditor(page, path);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await dialog.getByRole('tab', { name: /Appearance$/u }).click();
		await expect(dialog.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
		await dialog.getByRole('radio', { name: 'Light', exact: true }).check();
		await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
		await page.reload(); editor = await waitForEditor(page);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		await dialog.getByRole('tab', { name: /Appearance$/u }).click();
		await expect(dialog.getByRole('radio', { name: 'Light', exact: true })).toBeChecked();
		await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
		await page.evaluate(() => sessionStorage.setItem('test-managed-launch', 'next-launch'));
		await page.reload(); editor = await waitForEditor(page);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		await dialog.getByRole('tab', { name: /Appearance$/u }).click();
		await expect(dialog.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
	});
	test(`browser General preferences omit desktop update checks in ${path}`, async ({ page }) => {
		const editor = await bootEditor(page, path);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		await expect(page.getByRole('dialog', { name: 'Editor preferences', exact: true })
			.getByRole('checkbox', { name: 'Check for updates', exact: true })).toHaveCount(0);
	});
}

async function installDesktopBridge(page, available, managed = false) {
	await installDesktopSpeedWarmupManifest(page);
	await page.addInitScript(({ available, managed }) => {
		globalThis.soundscaperDesktop = { v1: {
			getEnvironment: async () => managed ? { platform: 'linux', locale: 'en', supportedLocales: ['en'], capabilities: {},
				managedPreferences: { launchId: sessionStorage.getItem('test-managed-launch') ?? 'first-launch', preferences: { appearance: { theme: 'dark' } } } } : null,
			signalReady: () => undefined,
			onOpenProject: () => () => {}, onCloseRequested: () => () => {},
			onMenuCommand: () => () => {}, onWindowStateChanged: () => () => {},
			getExternalFfmpegStatus: async () => ({ state: 'unconfigured', location: null, version: null, detail: '', canInstall: false, canBrowse: false, canClear: false }),
			updatePreferences: async enabled => {
				if (enabled !== undefined && available) localStorage.setItem('test-update-checks', String(enabled));
				return { available, enabled: available && localStorage.getItem('test-update-checks') !== 'false' };
			},
		} };
	}, { available, managed });
}
