/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('keyboard traversal to the note edit surface exposes a visible focus indicator', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor,[{name:'focus.mid',mimeType:'audio/midi',buffer:Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00','hex')}]);
	await chooseNestedCommandAction(page, editor,'Window',['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', {exact:true});
	const notes = panel.getByRole('group',{name:'Note editor',exact:true});
	await notes.getByRole('combobox',{name:'Selected note',exact:true}).selectOption({index:1});
	await notes.getByRole('button',{name:'Preview selected note',exact:true}).focus();
	await page.keyboard.press('Tab');
	await expect(panel.locator('[data-piano-key][tabindex="0"]')).toBeFocused();
	await page.keyboard.press('Tab');
	const grid = panel.locator('.kw-audio-editor__piano-roll-notes > [tabindex="0"]');
	await expect(grid).toBeFocused();
	const focus = await grid.evaluate(node=>{const style=getComputedStyle(node);return {outline:style.outlineStyle,width:parseFloat(style.outlineWidth),shadow:style.boxShadow};});
	expect(focus.outline !== 'none' && focus.width > 0 || focus.shadow !== 'none').toBe(true);
});
