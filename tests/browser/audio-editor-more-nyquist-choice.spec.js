/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles, openNestedCommandMenu, registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { exportGuideSamples } from './helpers/guide-audio-results.js';
import { registerNyquistArchivePublication } from './helpers/nyquist-archive-publication.js';

registerAudioEditorHooks();

test('published HQ-Tone offers its waveform choices and generates the chosen wave', async ({ page }) => {
	test.setTimeout(90_000);
	await registerNyquistArchivePublication(page, ['HQ-Tone.ny']);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'short.wav', duration: 0.02 })]);
	let menu = await openNestedCommandMenu(page, editor, 'Effect', ['Nyquist']);
	await menu.getByRole('menuitem', { name: 'Get effects', exact: true }).click();
	const catalog = page.getByRole('dialog', { name: 'Get effects', exact: true });
	await catalog.getByRole('searchbox', { name: 'Search effects' }).fill('HQ-Tone');
	await catalog.getByRole('button', { name: 'Install HQ-Tone', exact: true }).click();
	await expect(catalog.getByRole('button', { name: 'Remove HQ-Tone', exact: true })).toBeVisible({ timeout: 20_000 });
	await catalog.getByRole('button', { name: 'Close', exact: true }).last().click();
	menu = await openNestedCommandMenu(page, editor, 'Generate', ['Nyquist']);
	await menu.getByRole('menuitem', { name: 'HQ-Tone', exact: true }).click();
	const plugin = page.getByRole('dialog', { name: 'HQ-Tone', exact: true });
	const waveform = plugin.getByRole('combobox', { name: 'Waveform', exact: true });
	await expect(waveform.locator('option')).toHaveText(['Sine', 'Square', 'Triangle', 'Saw', 'Inverse Saw']);
	await waveform.selectOption('3');
	await plugin.getByRole('spinbutton', { name: 'Duration', exact: true }).fill('0.02');
	await plugin.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(plugin).toBeHidden({ timeout: 20_000 });
	const result = await exportGuideSamples(page);
	expect(result.channels[0].some(value => Math.abs(value) > 0.1)).toBe(true);
});
