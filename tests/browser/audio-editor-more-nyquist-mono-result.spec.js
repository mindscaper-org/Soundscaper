/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker, importFiles, openNestedCommandMenu } from './audio-editor-test-helpers.js';
import { exportGuideSamples } from './helpers/guide-audio-results.js';
import { registerNyquistArchivePublication } from './helpers/nyquist-archive-publication.js';

test('published Vocal Reduction applies its mono result to the imported stereo recording', async ({ page }) => {
	await registerNyquistArchivePublication(page, ['vocalrediso.ny']);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'stereo.wav', frequency: 440, duration: .1, channelCount: 2, channelAmplitudes: [.4, .1] })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	let menu = await openNestedCommandMenu(page, editor, 'Effect', ['Nyquist']);
	await menu.getByRole('menuitem', { name: 'Get effects', exact: true }).click();
	const catalog = page.getByRole('dialog', { name: 'Get effects', exact: true });
	await catalog.getByRole('searchbox', { name: 'Search effects' }).fill('Vocal reduction and isolation');
	await catalog.getByRole('button', { name: 'Install Vocal reduction and isolation', exact: true }).click();
	await expect(catalog.getByRole('button', { name: 'Remove Vocal reduction and isolation', exact: true })).toBeVisible();
	await catalog.getByRole('button', { name: 'Close', exact: true }).last().click();
	menu = await openNestedCommandMenu(page, editor, 'Effect', ['Nyquist']);
	await menu.getByRole('menuitem', { name: 'Vocal reduction and isolation', exact: true }).click();
	const effect = page.getByRole('dialog', { name: 'Vocal reduction and isolation', exact: true });
	await expect(effect.getByRole('combobox', { name: 'Action', exact: true })).toHaveValue('0');
	await effect.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(effect).toBeHidden();
	const output = await exportGuideSamples(page);
	expect(output.channels).toHaveLength(2);
	expect(Math.max(...output.channels[0].map((sample, index) => Math.abs(sample - output.channels[1][index])))).toBeLessThan(4 / 2 ** 23);
	expect(output.channels[0].some(value => Math.abs(value) > .01)).toBe(true);
});
