/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, chooseExportProjectFileAction, chooseNestedCommandAction, waitForEditor } from './audio-editor-test-helpers.js';
import { installDesktopSpeedWarmupManifest } from './helpers/desktop-speed-warmup-fixture.js';

for (const path of ['/embed/en/', '/framescaper/embed/en/']) test(`web saving and temporary-project preferences persist in ${path}`, async ({ page }) => {
	let editor = await bootEditor(page, path);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	const auto = dialog.getByRole('group', { name: 'Auto-saving', exact: true });
	await expect(auto.getByRole('button')).toContainText('On');
	await expect(dialog.getByRole('group', { name: 'Ask to save projects when closing', exact: true })).toHaveCount(0);
	await chooseDropdown(page, auto, 'Off');
	await dialog.getByRole('tab', { name: /Advanced$/u }).click();
	const limit = dialog.getByRole('spinbutton', { name: 'Temporary project limit', exact: true });
	await expect(limit).toHaveValue('10');
	await limit.fill('4'); await limit.press('Enter');
	await expect(limit).toHaveValue('4');
	await dialog.getByRole('checkbox', { name: 'Maximum number of temporary projects', exact: true }).click();
	await expect(limit).toBeDisabled();
	await expect(dialog.getByRole('textbox', { name: 'Temporary data folder', exact: true })).toHaveValue('Browser storage');
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await page.reload(); editor = await waitForEditor(page);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	await expect(auto.getByRole('button')).toContainText('Off');
	await dialog.getByRole('tab', { name: /Advanced$/u }).click();
	await expect(limit).toHaveValue('4'); await expect(limit).toBeDisabled();
});

test('desktop saving defaults and temporary data folder selection are exposed in Preferences', async ({ page }) => {
	await installDesktopSpeedWarmupManifest(page);
	await page.addInitScript(() => {
		const status = { folder: '/original', selectedFolder: '/original', restartRequired: false };
		globalThis.soundscaperDesktop = { v1: {
			getEnvironment: async () => null, signalReady: async () => undefined,
			onOpenProject: () => () => {}, onCloseRequested: listener => { globalThis.__requestProjectClose = listener; return () => {}; }, onMenuCommand: () => () => {}, onWindowStateChanged: () => () => {},
			getExternalFfmpegStatus: async () => ({ state: 'unconfigured', location: null, version: null, detail: '', canInstall: false, canBrowse: false, canClear: false }),
			confirmProjectSave: async request => { globalThis.__projectClosePrompt = request; return 'cancel'; },
			respondToClose: response => { globalThis.__projectCloseResponse = response; },
			temporaryDataStatus: async () => status,
			chooseTemporaryDataFolder: async () => ({ ...status, selectedFolder: '/chosen', restartRequired: true }),
		} };
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await expect(dialog.getByRole('group', { name: 'Auto-saving', exact: true }).getByRole('button')).toContainText('Off');
	await expect(dialog.getByRole('group', { name: 'Ask to save projects when closing', exact: true }).getByRole('button')).toContainText('On');
	await dialog.getByRole('tab', { name: /Advanced$/u }).click();
	const panel = dialog.getByRole('tabpanel', { name: 'Advanced', exact: true });
	await expect(panel.getByRole('textbox', { name: 'Temporary data folder', exact: true })).toHaveValue('/original');
	await panel.getByRole('button', { name: 'Browse', exact: true }).click();
	await expect(panel.getByRole('textbox', { name: 'Temporary data folder', exact: true })).toHaveValue('/chosen');
	await expect(panel.getByRole('status')).toContainText('restart the app');
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	const unexpectedDialogs = [];
	page.on('dialog', nativeDialog => { unexpectedDialogs.push(nativeDialog.message()); void nativeDialog.dismiss(); });
	await renameProject(page, editor, 'Unsaved desktop project');
	await page.evaluate(() => globalThis.__requestProjectClose({ requestId: 'closing', reason: 'quit' }));
	await expect.poll(() => page.evaluate(() => globalThis.__projectCloseResponse?.allow)).toBe(false);
	await expect.poll(() => page.evaluate(() => globalThis.__projectClosePrompt?.message)).toContain('Unsaved desktop project');
	expect(unexpectedDialogs).toEqual([]);
});

test('web autosaving updates a saved file handle, Off retains recovery edits until Save', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await page.evaluate(() => {
		globalThis.__projectFileWrites = 0;
		Object.defineProperty(globalThis, 'showSaveFilePicker', { configurable: true, value: async () => ({ name: 'working.sscape',
			createWritable: async () => ({ write: async () => {}, close: async () => { globalThis.__projectFileWrites += 1; }, abort: async () => {} }),
		}) });
	});
	await chooseExportProjectFileAction(page, editor);
	await expect.poll(() => page.evaluate(() => globalThis.__projectFileWrites)).toBe(1);
	await renameProject(page, editor, 'Automatically saved');
	await expect.poll(() => page.evaluate(() => globalThis.__projectFileWrites)).toBe(2);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Auto-saving', exact: true }), 'Off');
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await renameProject(page, editor, 'Saved manually');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await chooseCommandAction(page, editor, 'File', 'Save project');
	await expect.poll(() => page.evaluate(() => globalThis.__projectFileWrites)).toBe(3);
});

async function renameProject(page, editor, name) {
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	const dialog = page.getByRole('dialog', { name: 'Rename project', exact: true });
	const field = dialog.getByRole('textbox'); await field.fill(name);
	await dialog.getByRole('button', { name: 'Save name', exact: true }).click();
	await expect(editor.locator('[data-project-name]')).toHaveText(name);
}
