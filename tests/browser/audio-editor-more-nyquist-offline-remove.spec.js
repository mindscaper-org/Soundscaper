/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, openNestedCommandMenu } from './audio-editor-test-helpers.js';
import { registerNyquistArchivePublication } from './helpers/nyquist-archive-publication.js';

test('installed Nyquist effects can be removed when the remote catalog is unavailable', async ({ page }) => {
	await registerNyquistArchivePublication(page, ['HQ-Tone.ny']);
	const editor = await bootEditor(page, '/embed/en/');
	let menu = await openNestedCommandMenu(page, editor, 'Effect', ['Nyquist']);
	await menu.getByRole('menuitem', { name: 'Get effects', exact: true }).click();
	let catalog = page.getByRole('dialog', { name: 'Get effects', exact: true });
	await catalog.getByRole('searchbox', { name: 'Search effects' }).fill('HQ-Tone');
	await catalog.getByRole('button', { name: 'Install HQ-Tone', exact: true }).click();
	await expect(catalog.getByRole('button', { name: 'Remove HQ-Tone', exact: true })).toBeVisible();
	await catalog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await page.route('**/plugins/nyquist/audacityteam.org/**', route => route.abort('internetdisconnected'));
	menu = await openNestedCommandMenu(page, editor, 'Effect', ['Nyquist']);
	await menu.getByRole('menuitem', { name: 'Get effects', exact: true }).click();
	catalog = page.getByRole('dialog', { name: 'Get effects', exact: true });
	await expect(catalog.getByRole('alert')).toBeVisible();
	await catalog.getByRole('searchbox', { name: 'Search effects' }).fill('HQ-Tone');
	await catalog.getByRole('button', { name: 'Remove HQ-Tone', exact: true }).click({ timeout: 5_000 });
	await expect(catalog.getByRole('button', { name: 'Remove HQ-Tone', exact: true })).toHaveCount(0);
	await expect(catalog.getByRole('alert')).toBeVisible();
	await expect(catalog.getByRole('status')).toHaveCount(0);
	expect(await page.evaluate(() => JSON.parse(localStorage.getItem('soundscaper-nyquist-archive-plugins-v1')))).toEqual([]);
});
