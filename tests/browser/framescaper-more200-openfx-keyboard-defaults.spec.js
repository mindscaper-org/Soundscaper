/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { openNativePreferences } from './helpers/assistance-task-menu.js';
import { installNativeServicesFixture } from './helpers/framescaper-native-services-fixture.js';

test.use({ viewport: { width: 1280, height: 520 } });
test('OpenFX native Home does not scroll its application surface away', async ({ page }) => {
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
	await canvas.focus();
	const scrolling = () => canvas.evaluate(element => {
		const values = [];
		for (let parent = element.parentElement; parent; parent = parent.parentElement) {
			if (parent.scrollHeight > parent.clientHeight + 1) values.push({ tag: parent.tagName, className: parent.className, top: parent.scrollTop, height: parent.clientHeight, content: parent.scrollHeight });
		}
		return values;
	});
	const before = await scrolling();
	await page.evaluate(() => document.addEventListener('keydown', event => {
		if (event.key === 'Home') globalThis.__ofxHomeDefaultPrevented = event.defaultPrevented;
	}));
	await canvas.press('Home');
	await expect.poll(() => page.evaluate(() => globalThis.__ofxHomeDefaultPrevented)).toBe(true);
	await expect.poll(scrolling).toEqual(before);
	await expect.poll(() => page.evaluate(() => globalThis.__framescaperNativeCalls
		.filter(([kind]) => kind === 'runOpenFxInteract').some(([, request]) =>
			request.events.some(event => event.kind === 'keyboard' && event.key === 'Home' && event.phase === 'up')))).toBe(true);
	await canvas.press('Tab');
	await expect(canvas).not.toBeFocused();
	await expect(dialog).toBeVisible();
	await canvas.focus();
	await canvas.press('Escape');
	await expect(dialog).toHaveCount(0);
});
