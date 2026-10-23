/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { openNativePreferences } from './helpers/assistance-task-menu.js';
import { installNativeServicesFixture } from './helpers/framescaper-native-services-fixture.js';

test('a completed OpenFX reply does not erase a gesture started while it was pending', async ({ page }) => {
	test.setTimeout(120_000);
	await installNativeServicesFixture(page, { parameters: [{ name: 'count', type: 'integer', animates: false }] });
	await page.addInitScript(() => {
		const define = Object.defineProperty;
		const wrap = desktop => {
		const original = desktop.v1.nativeServices; let first = true;
		return Object.freeze({ ...desktop, v1: Object.freeze({ ...desktop.v1,
			nativeServices: Object.freeze({ ...original, runOpenFxInteract: async request => {
				const last = request.events.at(-1), terminal = last?.kind === 'focus' && !last.focused;
				if (terminal && first) {
					first = false; globalThis.__firstInteractPending = true;
					await new Promise(resolve => { globalThis.__releaseInteract = resolve; });
				}
				const result = await original.runOpenFxInteract(request);
				const count = request.effect.parameters.find(parameter => parameter.name === 'count');
				return { ...result, parameterMutations: terminal ? [{ parameter: { ...count, value: count.value
					+ request.events.filter(event => event.kind === 'keyboard' && event.phase === 'down').length } }] : [] };
			} }),
		}) });
		};
		if (globalThis.framescaperDesktop) define(globalThis, 'framescaperDesktop', { configurable: true, value: wrap(globalThis.framescaperDesktop) });
		else Object.defineProperty = function (object, key, descriptor) {
			if (object === globalThis && key === 'framescaperDesktop') {
				Object.defineProperty = define; descriptor = { ...descriptor, value: wrap(descriptor.value) };
			}
			return Reflect.apply(define, Object, [object, key, descriptor]);
		};
	});
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
	await form.getByRole('button', { name: 'Add OpenFX effect', exact: true }).click();
	await expect(form.getByRole('status')).toContainText('OpenFX effect added.');
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video effects', 'Open OFX Interact']);
	dialog = page.locator('[data-framescaper-native-services-dialog="true"]');
	const canvas = dialog.locator('[data-framescaper-openfx-interact-canvas="64x64"]');
	await expect(canvas).toBeVisible();
	const target = dialog.locator('[data-framescaper-openfx-interact-target]');
	await canvas.focus(); await canvas.press('ArrowRight'); await target.focus();
	await expect.poll(() => page.evaluate(() => globalThis.__firstInteractPending)).toBe(true);
	await canvas.focus(); await page.keyboard.down('ArrowRight');
	await page.evaluate(() => globalThis.__releaseInteract());
	await expect.poll(() => page.evaluate(() => globalThis.__framescaperNativeCalls
		.filter(([kind, request]) => kind === 'runOpenFxInteract' && request.effect.parameters[0]?.value === 1).length)).toBeGreaterThan(0);
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	await page.keyboard.up('ArrowRight'); await target.focus();
	await expect.poll(() => page.evaluate(() => globalThis.__framescaperNativeCalls
		.filter(([kind, request]) => kind === 'runOpenFxInteract' && request.events.at(-1)?.kind === 'focus'
			&& request.events.at(-1)?.focused === false).length)).toBe(2);
	const last = await page.evaluate(() => globalThis.__framescaperNativeCalls
		.filter(([kind, request]) => kind === 'runOpenFxInteract' && request.events.at(-1)?.kind === 'focus'
			&& request.events.at(-1)?.focused === false).at(-1)[1]);
	expect(last.events.map(event => event.kind === 'focus' ? `focus:${event.focused}` : `${event.kind}:${event.phase}`))
		.toEqual(['focus:true', 'keyboard:down', 'keyboard:up', 'focus:false']);
	await dialog.locator('button').filter({ hasText: /^Close$/u }).click();
	const offset = await page.evaluate(() => globalThis.__framescaperNativeCalls.length);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video effects', 'Open OFX Interact']);
	await expect.poll(() => page.evaluate(offset => globalThis.__framescaperNativeCalls.slice(offset)
		.filter(([kind, request]) => kind === 'runOpenFxInteract' && request.events.length === 0)
		.at(-1)?.[1].effect.parameters.find(parameter => parameter.name === 'count').value, offset)).toBe(2);
});
