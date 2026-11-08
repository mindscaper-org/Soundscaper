/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

for (const key of ['Enter','Escape']) test(`manual value entry keeps composing ${key} inside its input method`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Window','Mixer');
	const volume = editor.locator('.kw-audio-editor__mixer-channel--master').getByRole('slider', {name:/volume$/u});
	await volume.click({button:'right'});
	await page.getByRole('menuitem', {name:'Enter value',exact:true}).click();
	const dialog = page.getByRole('dialog', {name:/Master.*volume/iu});
	await expect(dialog).toBeVisible();
	const value = dialog.getByRole('textbox', {name:'Value',exact:true});
	await value.fill('5');
	const prevented = await value.evaluate((node, composeKey) => {
		const event = new KeyboardEvent('keydown', {key:composeKey,bubbles:true,cancelable:true,isComposing:true});
		node.dispatchEvent(event); return event.defaultPrevented;
	}, key);
	await expect(dialog).toBeVisible();
	expect(prevented).toBe(false);
	await expect(volume).toHaveAttribute('aria-valuenow','0');
	await value.press(key);
	await expect(dialog).toBeHidden();
	await expect(volume).toHaveAttribute('aria-valuenow', key === 'Enter' ? '5' : '0');
});
