/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { openNativePreferences } from './helpers/assistance-task-menu.js';
import { installNativeServicesFixture } from './helpers/framescaper-native-services-fixture.js';

for (const dismiss of ['Close', 'Escape']) test(`OpenFX retains completed edits when dismissed with ${dismiss}`, async ({ page }) => {
	test.setTimeout(120_000);
	await installNativeServicesFixture(page, { parameters: [{ name: 'enabled', type: 'boolean', animates: false }] });
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid']);
	await expect(editor.getByRole('group', { name: 'Video clip: Solid', exact: true })).toHaveCount(1);
	await openNativePreferences(page, editor, 'Media', 'Native media and scratch');
	let dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	await dialog.locator('[data-native-service-preference="native-media"]').check();
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();
	await chooseCommandAction(page, editor, 'Effect', 'Plugin Manager');
	dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	await dialog.getByText('Scanning & Settings', { exact: true }).click();
	await dialog.getByRole('checkbox', { name: 'Allow OpenFX plugin scanning and execution' }).check();
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video effects', 'Add OFX']);
	dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	const form = dialog.locator('[data-framescaper-openfx-add-form="true"]');
	await form.locator('[data-openfx-parameter-type="boolean"] input').check();
	await form.getByRole('button', { name: 'Add OpenFX effect', exact: true }).click();
	await expect(form.getByRole('status')).toContainText('OpenFX effect added.');
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video effects', 'Open OFX Interact']);
	dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	const canvas = dialog.locator('[data-framescaper-openfx-interact-canvas="64x64"]');
	await expect(canvas).toBeVisible();
	await canvas.focus(); await canvas.press('ArrowRight');
	if (dismiss === 'Close') await dialog.locator('button').filter({ hasText: /^Close$/u }).click();
	else await canvas.press('Escape');
	await expect(dialog).toHaveCount(0);
	const offset = await page.evaluate(() => globalThis.__framescaperNativeCalls.length);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video effects', 'Open OFX Interact']);
	await expect.poll(() => page.evaluate(offset => globalThis.__framescaperNativeCalls.slice(offset)
		.filter(([kind, request]) => kind === 'runOpenFxInteract' && request.events.length === 0)
		.at(-1)?.[1].effect.parameters.find(parameter => parameter.name === 'enabled').value, offset)).toBe(false);
	for (const [action, enabled] of [['Undo', true], ['Redo', false]]) {
		await dialog.locator('button').filter({ hasText: /^Close$/u }).click();
		await chooseCommandAction(page, editor, 'Edit', action);
		const after = await page.evaluate(() => globalThis.__framescaperNativeCalls.length);
		await chooseNestedCommandAction(page, editor, 'Effect', ['Video effects', 'Open OFX Interact']);
		await expect.poll(() => page.evaluate(offset => globalThis.__framescaperNativeCalls.slice(offset)
			.filter(([kind, request]) => kind === 'runOpenFxInteract' && request.events.length === 0)
			.at(-1)?.[1].effect.parameters.find(parameter => parameter.name === 'enabled').value, after)).toBe(enabled);
	}
});
