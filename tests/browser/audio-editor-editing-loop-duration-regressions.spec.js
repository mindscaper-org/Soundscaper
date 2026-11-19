/* SPDX-License-Identifier: AGPL-3.0-only */

import { setClipTimeFrames } from './audio-editor-clip-timing-test-helpers.js';
import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { showClipTimingFields, bootEditor, clipByName, importFiles, openClipProperties, closeClipProperties, chooseCommandAction,
	chooseNestedCommandAction, clickClipInterior } from './audio-editor-test-helpers.js';

test('duration edits preserve the loop period and Join restores a split first repetition', async ({ page }) => {
	const caseTimeout = test.info().timeout;
	test.setTimeout(caseTimeout * 2);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await preferences.getByRole('checkbox', { name: 'Apply 2 ms fades to new clips', exact: true }).uncheck();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await test.step('edit the total loop duration', async () => {
		await importFiles(editor, [monoTone]);
		const clip = clipByName(editor, monoTone.name);
		await clip.locator('.clip-header').click();
		await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
		const properties = await openClipProperties(page, editor, clip);
		await showClipTimingFields(properties);
		await setClipTimeFrames(properties, 'durationFrame', 57600);
		await expect(clip).toHaveAccessibleName(/1\.2 seconds long$/u);
		await expect(clip.locator('[data-loop-boundary-frame]')).toHaveAttribute('data-loop-boundary-frame', '38400');
		await closeClipProperties(properties);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(clip).toHaveAccessibleName(/1\.6 seconds long$/u);
	}, { timeout: caseTimeout });
	await test.step('split and rejoin the first repetition', async () => {
		const clip = clipByName(editor, monoTone.name);
		const split = editor.getByRole('button', { name: 'Split tool', exact: true });
		await split.click();
		await clickClipInterior(page, clip, 0.25);
		await split.click();
		const parts = editor.locator('[data-clip-id]');
		await expect(parts).toHaveCount(2);
		await parts.nth(0).press('Enter');
		await parts.nth(1).press('Shift+Enter');
		await expect(parts.locator('.clip-display[data-selected="true"]')).toHaveCount(2);
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Join']);
		await expect(parts).toHaveCount(1);
		await expect(parts).toHaveAccessibleName(/1\.6 seconds long$/u);
		await expect(parts.locator('[data-loop-boundary-frame]')).toHaveAttribute('data-loop-boundary-frame', '38400');
	}, { timeout: caseTimeout });
});
