/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('undoing a newly added MIDI note during its held drag retires the obsolete edit',async({page})=>{
	const editor=await bootEditor(page,'/embed/en/', { showProjectBin: false });
	await importFiles(editor,[{name:'undo-drag.mid',mimeType:'audio/midi',buffer:Buffer.from('4d546864000000060000000101e04d54726b0000001400ff510307a12000904064836080400000ff2f00','hex')}]);
	await chooseNestedCommandAction(page,editor,'Window',['Piano roll (beta)']);
	const panel=editor.getByLabel('Piano roll (beta)',{exact:true});
	await panel.getByRole('button',{name:'Add note',exact:true}).click();
	const note=panel.locator('.note-rect[data-note-id="2"]');
	await expect(note).toBeVisible();
	const rect=await note.boundingBox(); expect(rect).not.toBeNull();
	const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
	await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x+25,y,{steps:3});
	await page.keyboard.press('Control+z');
	await expect(note).toHaveCount(0);
	await page.mouse.move(x+50,y,{steps:3}); await page.mouse.up();
	await expect(editor.getByText(/MIDI note .* is missing\./u)).toHaveCount(0);
});
