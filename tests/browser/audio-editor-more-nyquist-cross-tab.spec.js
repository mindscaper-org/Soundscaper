/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, openNestedCommandMenu } from './audio-editor-test-helpers.js';
import { registerNyquistArchivePublication } from './helpers/nyquist-archive-publication.js';

test('Get effects reflects plug-ins installed and removed in another editor tab', async ({ page, context }) => {
	await registerNyquistArchivePublication(page, ['HQ-Tone.ny']);
	const editor = await bootEditor(page, '/embed/en/');
	let menu = await openNestedCommandMenu(page, editor, 'Effect', ['Nyquist']);
	await menu.getByRole('menuitem', { name: 'Get effects', exact: true }).click();
	const catalog = page.getByRole('dialog', { name: 'Get effects', exact: true });
	await catalog.getByRole('searchbox', { name: 'Search effects' }).fill('HQ-Tone');
	await expect(catalog.getByRole('button', { name: 'Install HQ-Tone', exact: true })).toBeVisible();
	const other = await context.newPage();
	await registerNyquistArchivePublication(other, ['HQ-Tone.ny']);
	const otherEditor = await bootEditor(other, '/embed/en/');
	menu = await openNestedCommandMenu(other, otherEditor, 'Effect', ['Nyquist']);
	await menu.getByRole('menuitem', { name: 'Get effects', exact: true }).click();
	const otherCatalog = other.getByRole('dialog', { name: 'Get effects', exact: true });
	await otherCatalog.getByRole('searchbox', { name: 'Search effects' }).fill('HQ-Tone');
	await otherCatalog.getByRole('button', { name: 'Install HQ-Tone', exact: true }).click();
	await expect(otherCatalog.getByRole('button', { name: 'Remove HQ-Tone', exact: true })).toBeVisible();
	await expect(catalog.getByRole('button', { name: 'Remove HQ-Tone', exact: true })).toBeVisible();
	await otherCatalog.getByRole('button', { name: 'Remove HQ-Tone', exact: true }).click();
	await expect(catalog.getByRole('button', { name: 'Install HQ-Tone', exact: true })).toBeVisible();
	await other.close();
});
