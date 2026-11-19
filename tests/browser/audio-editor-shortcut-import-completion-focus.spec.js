/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('keyboard shortcut import completion hands focus to its surviving Import control', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	const importing = preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true });
	const choosing = page.waitForEvent('filechooser');
	await importing.click();
	await (await choosing).setFiles({ name: 'audacity.xml', mimeType: 'application/xml', buffer: Buffer.from(
		'<audacitykeyboard audacityversion="3.7.7"><command name="NewMonoTrack" key="Ctrl+Alt+Shift+F6"/></audacitykeyboard>') });
	const review = preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true });
	const apply = review.getByRole('button', { name: 'Apply shortcuts', exact: true });
	await apply.focus();
	await apply.press('Enter');
	await expect(preferences.getByRole('status').filter({ hasText: 'Imported 1 command.' })).toBeVisible();
	await expect(importing).toBeFocused();
});

test('shortcut import completion preserves a later selected search field', async ({ page }) => {
	await page.addInitScript(() => {
		let release;
		const gate = new Promise(resolve => { release = resolve; });
		globalThis.__releaseShortcutImport = () => release();
		globalThis.__waitForImportSave = async operation => {
			globalThis.__shortcutImportWaiting = true;
			await gate;
			return operation();
		};
	});
	await page.route('**/editor-controller-core-*.js', async route => {
		const response = await route.fetch();
		const body = await response.text();
		const next = body.replace(/await\s+([\w$]+)\.saveShortcuts\(([\w$]+)\.shortcuts\)/u,
			'await globalThis.__waitForImportSave(()=>$1.saveShortcuts($2.shortcuts))');
		await route.fulfill({ response, body: next });
	});
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	const importing = preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true });
	const choosing = page.waitForEvent('filechooser');
	await importing.click();
	await (await choosing).setFiles({ name: 'audacity.xml', mimeType: 'application/xml', buffer: Buffer.from(
		'<audacitykeyboard audacityversion="3.7.7"><command name="NewMonoTrack" key="Ctrl+Alt+Shift+F6"/></audacitykeyboard>') });
	const review = preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true });
	await review.getByRole('button', { name: 'Apply shortcuts', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__shortcutImportWaiting)).toBe(true);
	const search = preferences.getByRole('searchbox', { name: 'Search commands', exact: true });
	await search.focus();
	await search.pressSequentially('New');
	await expect(search).toBeFocused();
	await page.evaluate(() => globalThis.__releaseShortcutImport());
	await expect(preferences.getByRole('status').filter({ hasText: 'Imported 1 command.' })).toBeVisible();
	await expect(search).toBeFocused();
	await search.pressSequentially(' label');
	await expect(search).toHaveValue('New label');
});
