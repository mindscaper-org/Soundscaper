/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, waitForEditor } from './audio-editor-test-helpers.js';
import { installDesktopSpeedWarmupManifest } from './helpers/desktop-speed-warmup-fixture.js';

for (const path of ['/embed/en/', '/framescaper/embed/en/']) {
	test(`desktop effect memory defaults to 4 GiB and a larger Advanced preference survives reload in ${path}`, async ({ page }) => {
		await installDesktopSpeedWarmupManifest(page);
		await page.addInitScript(() => {
			globalThis.soundscaperDesktop = { v1: {
				getEnvironment: async () => null, signalReady: async () => undefined,
				onOpenProject: () => () => {}, onCloseRequested: () => () => {},
				onMenuCommand: () => () => {}, onWindowStateChanged: () => () => {},
				getExternalFfmpegStatus: async () => ({ state: 'unconfigured', location: null, version: null, detail: '', canInstall: false, canBrowse: false, canClear: false }),
			} };
		});
		let editor = await bootEditor(page, path);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await dialog.getByRole('tab', { name: /Advanced$/u }).click();
		const limit = dialog.getByRole('spinbutton', { name: 'Effect memory limit (GiB)', exact: true });
		await expect(limit).toHaveValue('4');
		await limit.fill('8'); await limit.press('Enter');
		await expect(limit).toHaveValue('8');
		await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
		await page.reload(); editor = await waitForEditor(page);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		await dialog.getByRole('tab', { name: /Advanced$/u }).click();
		await expect(limit).toHaveValue('8');
		await limit.fill('16'); await limit.press('Enter');
		await expect(limit).toHaveValue('16');
	});

	test(`browser Advanced preferences omit the desktop effect memory allowance in ${path}`, async ({ page }) => {
		const editor = await bootEditor(page, path);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await dialog.getByRole('tab', { name: /Advanced$/u }).click();
		await expect(dialog.getByRole('spinbutton', { name: 'Effect memory limit (GiB)', exact: true })).toHaveCount(0);
	});
}
