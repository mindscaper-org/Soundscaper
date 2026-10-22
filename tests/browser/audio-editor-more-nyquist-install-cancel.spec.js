/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, openNestedCommandMenu } from './audio-editor-test-helpers.js';
import { registerNyquistArchivePublication } from './helpers/nyquist-archive-publication.js';

test('closing Get effects while a downloaded plug-in is verified cancels installation', async ({ page }) => {
	await registerNyquistArchivePublication(page, ['HQ-Tone.ny']);
	const editor = await bootEditor(page, '/embed/en/');
	let menu = await openNestedCommandMenu(page, editor, 'Effect', ['Nyquist']);
	await menu.getByRole('menuitem', { name: 'Get effects', exact: true }).click();
	let catalog = page.getByRole('dialog', { name: 'Get effects', exact: true });
	await catalog.getByRole('searchbox', { name: 'Search effects' }).fill('HQ-Tone');
	await expect(catalog.getByRole('button', { name: 'Install HQ-Tone', exact: true })).toBeVisible();
	await page.evaluate(() => {
		const digest = crypto.subtle.digest.bind(crypto.subtle);
		crypto.subtle.digest = async (algorithm, data) => {
			const result = await digest(algorithm, data);
			if (new TextDecoder().decode(data).includes('name "HQ-Tone"')) {
				globalThis.nyquistVerificationPending = true;
				await new Promise(resolve => { globalThis.finishNyquistVerification = resolve; });
			}
			return result;
		};
	});
	await catalog.getByRole('button', { name: 'Install HQ-Tone', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.nyquistVerificationPending === true)).toBe(true);
	await catalog.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(catalog).toBeHidden();
	await page.evaluate(() => globalThis.finishNyquistVerification());
	menu = await openNestedCommandMenu(page, editor, 'Effect', ['Nyquist']);
	await menu.getByRole('menuitem', { name: 'Get effects', exact: true }).click();
	catalog = page.getByRole('dialog', { name: 'Get effects', exact: true });
	await catalog.getByRole('searchbox', { name: 'Search effects' }).fill('HQ-Tone');
	await expect(catalog.getByRole('button', { name: 'Install HQ-Tone', exact: true })).toBeVisible();
});
