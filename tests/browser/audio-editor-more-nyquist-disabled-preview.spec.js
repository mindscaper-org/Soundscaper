/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles, openNestedCommandMenu } from './audio-editor-test-helpers.js';
import { registerNyquistArchivePublication } from './helpers/nyquist-archive-publication.js';

test('published Trim Silence does not offer its explicitly disabled preview operation', async ({ page }) => {
	await registerNyquistArchivePublication(page, ['TrimSilence.ny']);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'trim.wav', frequency: 440, duration: .1 })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	let menu = await openNestedCommandMenu(page, editor, 'Effect', ['Nyquist']);
	await menu.getByRole('menuitem', { name: 'Get effects', exact: true }).click();
	const catalog = page.getByRole('dialog', { name: 'Get effects', exact: true });
	await catalog.getByRole('searchbox', { name: 'Search effects' }).fill('Trim Silence');
	await catalog.getByRole('button', { name: 'Install Trim Silence', exact: true }).click();
	await expect(catalog.getByRole('button', { name: 'Remove Trim Silence', exact: true })).toBeVisible();
	await catalog.getByRole('button', { name: 'Close', exact: true }).last().click();
	menu = await openNestedCommandMenu(page, editor, 'Effect', ['Nyquist']);
	await menu.getByRole('menuitem', { name: 'Trim Silence', exact: true }).click();
	const effect = page.getByRole('dialog', { name: 'Trim Silence', exact: true });
	await expect(effect.getByRole('button', { name: 'Preview', exact: true })).toHaveCount(0);
	await expect(effect.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
});
