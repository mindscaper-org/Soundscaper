/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { openNativePreferences } from './helpers/assistance-task-menu.js';
import { installNativeServicesFixture } from './helpers/framescaper-native-services-fixture.js';

for (const preheld of [true, false]) test(`OpenFX receives Shift ${preheld ? 'held before canvas focus' : 'pressed inside its canvas'}`, async ({ page }) => {
	test.setTimeout(120_000);
	await installNativeServicesFixture(page);
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
	await form.getByLabel('customState', { exact: true }).fill('opaque-state');
	await form.getByLabel('Custom encoding for customState', { exact: true }).fill('vendor-v1');
	await form.getByRole('button', { name: 'Add OpenFX effect', exact: true }).click();
	await expect(form.getByRole('status')).toContainText('OpenFX effect added.');
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video effects', 'Open OFX Interact']);
	dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	const canvas = dialog.locator('[data-framescaper-openfx-interact-canvas="64x64"]');
	await expect(canvas).toBeVisible();
	if (!preheld) await canvas.focus();
	await page.keyboard.down('Shift');
	await canvas.hover();
	await page.mouse.down();
	const box = await canvas.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box.x + 100, box.y + 100);
	await page.mouse.up();
	await page.keyboard.up('Shift');
	await canvas.press('Enter');
	await dialog.locator('[data-framescaper-openfx-interact-target="true"]').focus();
	const terminal = () => page.evaluate(() => globalThis.__framescaperNativeCalls
		.filter(([kind, request]) => kind === 'runOpenFxInteract' && request.events.at(-1)?.kind === 'focus'
			&& request.events.at(-1).focused === false).at(-1)?.[1].events);
	await expect.poll(terminal).toBeTruthy();
	const events = await terminal();
	expect(events.find(event => event.kind === 'pointer' && event.phase === 'down').modifiers).toContain('shift');
	expect(events.some(event => event.kind === 'keyboard' && event.phase === 'down' && event.key === 'Shift')).toBe(!preheld);
	expect(events.some(event => event.kind === 'keyboard' && event.phase === 'up' && event.key === 'Shift')).toBe(true);
	expect(events[0]).toMatchObject({ kind: 'focus', focused: true });
	expect(events.at(-1)).toMatchObject({ kind: 'focus', focused: false });
});
