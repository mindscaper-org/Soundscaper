/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '../audio-editor-test-fixtures.js';
import { chooseCommandAction, chooseNestedCommandAction, getMenuItem } from '../audio-editor-test-helpers.js';

export async function checkNativeContextMenu(page, editor) {
	await editor.evaluate(() => {
		globalThis.__editorContextMenuPrevented = undefined;
		window.addEventListener('contextmenu', event => { globalThis.__editorContextMenuPrevented = event.defaultPrevented; }, { once: true });
	});
	await editor.locator('.audio-editor-ruler-corner').click({ button: 'right' });
	expect(await page.evaluate(() => globalThis.__editorContextMenuPrevented)).toBe(true);
}

export async function checkUnavailableCommands(page, editor) {
	const menubar = editor.getByRole('menubar', { name: 'Application menu' });
	for (const [menuName, labels] of [
		['File', ['Export selected audio', 'Quit']],
		['View', ['Show piano roll']],
		['Tracks', ['Sync-lock tracks', 'MIDI track']],
		['Generate', ['Plugin manager']],
		['Effect', ['Plugin manager']],
		['Analyze', ['Plugin manager']],
		['Tools', [
			'Plugin manager',
			'Screenshot tools',
			'Run benchmark',
			'Reset configuration',
			'Sample data import',
			'Sample data export',
		]],
	]) {
		await menubar.getByRole('menuitem', { name: menuName, exact: true }).click();
		const menu = page.getByRole('menu', { name: menuName, exact: true });
		await expect(menu).toBeVisible();
		for (const label of labels) await expect(menu.getByRole('menuitem', { name: label, exact: true })).toHaveCount(0);
		await page.keyboard.press('Escape');
	}

	await menubar.getByRole('menuitem', { name: 'File', exact: true }).click();
	const fileMenu = page.getByRole('menu', { name: 'File', exact: true });
	await expect(getMenuItem(fileMenu, 'Close project')).toContainText('Ctrl+W');
	await expect(getMenuItem(fileMenu, 'Close project')).toHaveAttribute('aria-disabled', 'false');
	await page.keyboard.press('Escape');
	await chooseCommandAction(page, editor, 'Help', 'Check for updates');
	const desktopFeature = page.getByRole('dialog', { name: 'Desktop feature', exact: true });
	await expect(desktopFeature).toBeVisible();
	await desktopFeature.getByRole('button', { name: 'Cancel', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
	await expect(editor.locator('[data-workspace-panel="metadata"]')).toBeVisible();
}

export async function resetFactorySettings(page, editor) {
	const projectId = await editor.getAttribute('data-project-id');
	const clipCount = await editor.getAttribute('data-clip-count');

	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Appearance$/ }).click();
	await preferences.getByRole('radio', { name: 'Dark', exact: true }).click();
	await expect(editor).toHaveAttribute('data-editor-theme', 'dark');
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();

	await chooseCommandAction(page, editor, 'Help', 'Revert to factory settings');
	const confirmation = page.getByRole('dialog', { name: 'Revert to factory settings', exact: true });
	await expect(confirmation).toContainText('Projects and audio files will not be deleted.');
	await confirmation.getByRole('button', { name: 'Revert settings', exact: true }).click();

	await expect(confirmation).toBeHidden();
	await expect(editor).toHaveAttribute('data-editor-theme', 'system');
	await expect(editor).toHaveAttribute('data-workspace-preset', 'modern');
	await expect(editor).toHaveAttribute('data-project-id', projectId);

	await expect(editor).toHaveAttribute('data-clip-count', clipCount);
}

export async function checkTrackFlyout(page, editor) {

	const flyout = page.locator('.add-track-flyout');
	await expect(flyout).toBeVisible();
	await expect(flyout.getByRole('menuitem', { name: 'Audio track', exact: true })).toBeVisible();
	await expect(flyout.getByRole('menuitem', { name: 'Label track', exact: true })).toBeVisible();

	await flyout.getByRole('menuitem', { name: 'Audio track', exact: true }).click();
	await expect(flyout).toHaveCount(0);
	await expect(editor.locator('[data-track-row]')).toHaveCount(2);
}

export async function toggleTimelineMultiview(page, editor) {
	await page.keyboard.press('Escape');

	const track = editor.locator('[data-track-row]').first();
	await expect(track).toHaveAttribute('data-display-mode', 'waveform');

	const options = editor.getByRole('button', { name: 'Spectrogram options', exact: true });
	const multiView = () => editor.locator('[data-action-id="multiview-view"] [role="menuitem"]');
	await options.click();
	await multiView().click();
	await expect(track).toHaveAttribute('data-display-mode', 'multiview');
	await expect(editor.getByRole('button', { name: 'Spectrogram', exact: true }))
		.toHaveAttribute('aria-pressed', 'false');

	await options.click();
	// The vendored menu item marks its checked state with a checkmark icon.
	await expect(multiView().locator('.context-menu-item-checkmark .icon')).toHaveCount(1);
	await multiView().click();
	await expect(track).toHaveAttribute('data-display-mode', 'waveform');
}
