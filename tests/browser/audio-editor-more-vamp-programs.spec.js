/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { registerAudioEditorHooks } from './audio-editor-test-helpers.js';
import { openVampAnalyzer as openAnalyzer } from './helpers/vamp-analyzer-fixture.js';

registerAudioEditorHooks();

test('the Vamp menu preserves a selected program without default parameter overrides', async ({ page }) => {
	const dialog = await openAnalyzer(page);
	await dialog.getByRole('combobox', { name: 'Program', exact: true }).selectOption('Sensitive');
	await dialog.getByRole('button', { name: 'Analyze', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__moreVampConfigurations)).toHaveLength(1);
	const configuration = await page.evaluate(() => globalThis.__moreVampConfigurations[0]);
	expect(configuration.program).toBe('Sensitive');
	expect(configuration.parameters).toEqual({});
	await expect(dialog.getByLabel('Threshold', { exact: true })).toHaveValue('');
});

test('the Vamp Analyze footer reports an empty parameter without opening a native session', async ({ page }) => {
	const dialog = await openAnalyzer(page);
	await dialog.getByLabel('Threshold', { exact: true }).fill('');
	await dialog.getByRole('button', { name: 'Analyze', exact: true }).click();
	await expect(dialog.getByRole('alert')).toContainText('Enter a value for Threshold.');
	expect(await page.evaluate(() => globalThis.__moreVampConfigurations)).toEqual([]);
	await dialog.getByLabel('Threshold', { exact: true }).fill('0');
	await dialog.getByRole('button', { name: 'Analyze', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__moreVampConfigurations)).toHaveLength(1);
});
