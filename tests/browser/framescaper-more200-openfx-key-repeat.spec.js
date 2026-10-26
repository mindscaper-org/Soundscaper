/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { openNativePreferences } from './helpers/assistance-task-menu.js';
import { installNativeServicesFixture } from './helpers/framescaper-native-services-fixture.js';

test('OpenFX retains held-key repeats in the exact physical input journal', async ({ page }) => {
	test.setTimeout(120_000);
	await page.addInitScript(() => {
		globalThis.__repeatFlags = [];
		document.addEventListener('keydown', event => {
			if (event.target.matches('[data-framescaper-openfx-interact-canvas]')) globalThis.__repeatFlags.push(event.repeat);
		});
	});
	await installNativeServicesFixture(page, { parameters: [{ name: 'parameter0', type: 'integer', animates: true }] });
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
	await form.getByLabel('parameter0', { exact: true }).fill('3');
	await form.getByRole('button', { name: 'Add OpenFX effect', exact: true }).click();
	await expect(form.getByRole('status')).toContainText('OpenFX effect added.');
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video effects', 'Open OFX Interact']);
	dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	const canvas = dialog.locator('[data-framescaper-openfx-interact-canvas="64x64"]');
	await expect(canvas).toBeVisible();
	await canvas.focus();
	await page.keyboard.down('ArrowRight');
	await page.keyboard.down('ArrowRight');
	await page.keyboard.down('ArrowRight');
	await page.keyboard.up('ArrowRight');
	await dialog.locator('[data-framescaper-openfx-interact-target="true"]').focus();
	await expect.poll(() => page.evaluate(() => globalThis.__framescaperNativeCalls
		.filter(([kind, request]) => kind === 'runOpenFxInteract' && request.events.at(-1)?.kind === 'focus'
			&& request.events.at(-1).focused === false).length)).toBeGreaterThan(0);
	const events = await page.evaluate(() => globalThis.__framescaperNativeCalls
		.filter(([kind, request]) => kind === 'runOpenFxInteract' && request.events.at(-1)?.kind === 'focus'
			&& request.events.at(-1).focused === false).at(-1)[1].events);
	expect(await page.evaluate(() => globalThis.__repeatFlags)).toEqual([false, true, true]);
	expect(events).toEqual([
		{ kind: 'focus', sequence: 0, focused: true },
		...['down', 'down', 'down', 'up'].map((phase, index) => ({ kind: 'keyboard', phase,
			sequence: index + 1, key: 'ArrowRight', code: 'ArrowRight', modifiers: [] })),
		{ kind: 'focus', sequence: 5, focused: false },
	]);
});
