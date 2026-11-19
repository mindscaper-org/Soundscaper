/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles, waitForEditor } from './audio-editor-test-helpers.js';

test('changing the interface language keeps the current project when startup requests a new project', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [createWavFixture({ name: 'language-project.wav' })]);
	const projectId = await editor.getAttribute('data-project-id');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.locator('[data-program-start-option="new-project"] input').check();
	await expect(preferences.locator('[data-program-start]')).toHaveAttribute('data-program-start', 'new-project');
	await preferences.getByRole('group', { name: 'Language', exact: true }).getByRole('button').click();
	await page.getByRole('option', { name: 'Deutsch', exact: true }).click();
	await page.waitForURL('**/embed/de/');
	const localized = await waitForEditor(page);
	await expect(localized).toHaveAttribute('data-project-id', projectId);
	await expect(localized).toHaveAttribute('data-clip-count', '1');
	await expect(localized.getByRole('group', { name: /language-project\.wav/u })).toHaveCount(1);
});

test('the language menu still navigates when browser session storage refuses a write', async ({ page }) => {
	await page.addInitScript(() => {
		const original = Storage.prototype.setItem;
		Storage.prototype.setItem = function (key, value) {
			if (this === sessionStorage && key === 'locale-navigation-project') {
				throw new DOMException('Browser storage is full', 'QuotaExceededError');
			}
			return original.call(this, key, value);
		};
	});
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [createWavFixture({ name: 'language-storage-full.wav' })]);
	const projectId = await editor.getAttribute('data-project-id');
	await chooseGerman(page, editor);
	await expect(page).toHaveURL(/\/embed\/de\/$/u, { timeout: 5000 });
	await expect(await waitForEditor(page)).toHaveAttribute('data-project-id', projectId);
});

test('the localized workspace opens when browser session storage refuses a read', async ({ page }) => {
	await page.addInitScript(() => {
		const original = Storage.prototype.getItem;
		Storage.prototype.getItem = function (key) {
			if (this === sessionStorage && key === 'locale-navigation-project' && location.pathname === '/embed/de/') {
				throw new DOMException('Browser storage access was denied', 'SecurityError');
			}
			return original.call(this, key);
		};
	});
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor, [createWavFixture({ name: 'language-storage-denied.wav' })]);
	const projectId = await editor.getAttribute('data-project-id');
	await chooseGerman(page, editor);
	await expect(page).toHaveURL(/\/embed\/de\/$/u);
	const localized = page.locator('[data-audio-editor]');
	await expect(localized).toHaveAttribute('data-editor-ready', 'true');
	await expect(localized).toHaveAttribute('data-project-id', projectId);
});

test('changing language in the site sidebar keeps the current project', async ({ page }) => {
	const editor = await bootEditor(page, '/en/', { showProjectBin: false });
	await importFiles(editor, [createWavFixture({ name: 'sidebar-language.wav' })]);
	const projectId = await editor.getAttribute('data-project-id');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.locator('[data-program-start-option="new-project"] input').check();
	await expect(preferences.locator('[data-program-start]')).toHaveAttribute('data-program-start', 'new-project');
	await preferences.press('Escape');
	await expect(preferences).toBeHidden();

	await page.locator('[data-locale-select]').selectOption('de');
	await expect(page).toHaveURL(/\/de\/$/u);
	const localized = await waitForEditor(page);
	await expect(localized).toHaveAttribute('data-project-id', projectId);
	await expect(localized).toHaveAttribute('data-clip-count', '1');
});

async function chooseGerman(page, editor) {
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('group', { name: 'Language', exact: true }).getByRole('button').click();
	await page.getByRole('option', { name: 'Deutsch', exact: true }).click();
}
