/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';

test('multiline clip-name editing keeps paragraph paste and Shift+Enter inside the selected clip', async ({ page, browserName, context }) => {
	if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [
		createWavFixture({ name: 'First\nline.wav', duration: .05 }),
		createWavFixture({ name: 'Keep this clip.wav', duration: .05 }),
	]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Clip spreadsheet']);
	const grid = editor.locator('[data-workspace-panel="clip-spreadsheet"]').getByRole('grid');
	const name = grid.locator('[data-row="0"][data-column="name"]');
	const other = grid.locator('[data-row="1"][data-column="name"]');
	await name.dblclick();
	const draft = grid.getByRole('textbox', { name: 'Name', exact: true });
	await expect(draft).toHaveJSProperty('tagName', 'TEXTAREA');
	await draft.fill('First\nline');
	await draft.press('End');
	await draft.press('Shift+Enter');
	await expect(draft).toHaveValue('First\nline\n');
	await expect(other).toHaveText('Keep this clip');
	await draft.fill('');
	const paragraph = 'Revised\nparagraph';
	if (browserName === 'chromium') {
		await page.evaluate(text => navigator.clipboard.writeText(text), paragraph);
		await draft.press('ControlOrMeta+v');
	} else {
		// These engines lack Playwright OS clipboard grants; retain their real
		// bubbling paste policy, then emulate the allowed native text insertion.
		const allowed = await draft.evaluate((element, text) => {
			const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
			event.clipboardData.setData('text/plain', text);
			return element.dispatchEvent(event);
		}, paragraph);
		expect(allowed).toBe(true);
		await page.keyboard.insertText(paragraph);
	}
	await expect(draft).toHaveValue(paragraph);
	await expect(other).toHaveText('Keep this clip');
	await draft.press('Enter');
	await expect(draft).toHaveCount(0);
	await expect(name).toHaveText(paragraph);
	await page.keyboard.press('ControlOrMeta+z');
	await expect(name).toHaveText('First\nline');
	await expect(other).toHaveText('Keep this clip');
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect(name).toHaveText(paragraph);
	expect(errors).toEqual([]);
});
