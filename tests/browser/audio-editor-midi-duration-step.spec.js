/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('a native duration increment advances a valid half-second MIDI note by its declared millisecond step', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await importFiles(editor,[{name:'step.mid',mimeType:'audio/midi',buffer:Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000903c648360803c0000ff2f00','hex')}]);
	await chooseNestedCommandAction(page,editor,'Window',['Piano roll (beta)']);
	const fields = editor.getByRole('group',{name:'Note editor',exact:true});
	await fields.getByRole('combobox',{name:'Selected note',exact:true}).selectOption({index:1});
	const duration = fields.getByRole('spinbutton',{name:'Note duration (seconds)',exact:true});
	await expect(duration).toHaveValue('0.5');
	await duration.press('ArrowUp'); await duration.press('Tab');
	await expect(duration).toHaveValue('0.501');
	await duration.fill('0.001'); await duration.press('Enter');
	await expect(duration).toHaveValue('0.001');
	await expect(editor.locator('.note-rect[data-note-id="1"]')).toHaveCSS('width', '4px');
	await duration.press('ArrowDown'); await duration.press('Tab');
	await expect(duration).toHaveValue(String(1 / 48_000));
});
