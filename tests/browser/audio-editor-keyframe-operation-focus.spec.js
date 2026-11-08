/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('a completed keyframe form Enter retains its editable field focus',async({page})=>{
	const editor=await bootEditor(page,'/framescaper/embed/en/');
	await importFiles(editor,[createDeterministicAvFixture('keyframe-focus.webm')]);
	await editor.getByRole('group',{name:/^Video clip:/u}).press('Enter');
	await chooseNestedCommandAction(page,editor,'Edit',['Audio clips','Video keyframes']);
	const modal=page.getByRole('dialog',{name:'Video keyframes',exact:true});
	await modal.getByRole('combobox',{name:'Target',exact:true}).selectOption({label:'Scale X'});
	const end=modal.getByRole('spinbutton',{name:'End value',exact:true});
	await end.fill('1.2');
	await end.press('Enter');
	await expect(modal.getByRole('status')).toHaveText('Video keyframes applied.');
	await expect(end).toBeEnabled();
	await expect(end).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(modal.getByRole('combobox',{name:'Interpolation',exact:true}).first()).toBeFocused();
});
