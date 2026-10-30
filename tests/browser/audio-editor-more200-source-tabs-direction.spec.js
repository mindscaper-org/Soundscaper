/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles, waitForEditor } from './audio-editor-test-helpers.js';
import { openSourceMonitor } from './audio-editor-inspector-test-helpers.js';
import { clipDescriptionForLocale } from './audio-editor-clip-locators.js';

for (const locale of ['en', 'ar']) test(`Source monitor arrows follow visible recording tabs in ${locale}`, async ({ page }) => {
	let editor = await bootEditor(page, '/embed/en/');
	const third = { ...toneA, name: 'Third recording.wav' };
	await importFiles(editor, [toneA, toneB, third]);
	for (const [index, file] of [toneA, toneB, third].entries()) {
		await clipByName(editor, file.name).locator('.clip-header').click(index ? { modifiers: ['Shift'] } : {});
	}
	await openSourceMonitor(page, editor);
	if (locale === 'ar') {
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /General$/u }).click();
		await preferences.getByRole('button', { name: 'Language', exact: true }).click();
		await page.getByRole('option', { name: 'العربية', exact: true }).click();
		await expect(page).toHaveURL(/\/embed\/ar\//u);
		editor = await waitForEditor(page);
		await page.keyboard.press('Escape');
		await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
		const clipDescription = await clipDescriptionForLocale('ar');
		for (const [index, file] of [toneA, toneB, third].entries()) {
			await clipByName(editor, file.name, clipDescription).locator('.clip-header').click(index ? { modifiers: ['Shift'] } : {});
		}
	}
	const panel = editor.locator('[data-audio-source-monitor-panel]');
	const tabs = panel.getByRole('tab');
	await expect(tabs).toHaveCount(3);
	const middle = tabs.nth(1), next = tabs.nth(2);
	const middleBounds = await middle.boundingBox(), nextBounds = await next.boundingBox();
	if (locale === 'ar') expect(nextBounds.x).toBeLessThan(middleBounds.x);
	else expect(nextBounds.x).toBeGreaterThan(middleBounds.x);
	await middle.focus(); await middle.press(locale === 'ar' ? 'ArrowLeft' : 'ArrowRight');
	await expect(next).toBeFocused();
	await expect(next).toHaveAttribute('aria-selected', 'true');
	await next.press('Home'); await expect(tabs.first()).toBeFocused();
	await tabs.first().press('End'); await expect(next).toBeFocused();
	await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(3);
});
