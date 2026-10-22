/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { effectAutomationProject } from '../helpers/next-time-preserving-effect-project.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';
async function range(page,editor,start,end){for(const [name,value] of [['end',end],['start',start]]){const field=editor.getByRole('group',{name:`Selection ${name}`,exact:true});await field.locator('.timecode__format-button').click();await page.getByRole('menuitem',{name:'samples',exact:true}).click();const digits=field.locator('.timecode-digit');await digits.first().click();await page.keyboard.type(String(value).padStart(12,'0'));await page.keyboard.press('Enter');await expect.poll(async()=>Number((await digits.allTextContents()).join(''))).toBe(value);}}
test('Joined Paste Insert retains earlier gain automation and shifts its suffix',async({page})=>{
 const {project,source,samples}=effectAutomationProject();const store=createProjectStore({indexedDB:null,preferOpfs:false});let blob;
 try{const writer=await store.beginSourceWrite(source.storageKey,source);await writer.write([samples]);await writer.commit();blob=(await exportScapeProject(project,store)).blob;}finally{await store.close();}
 await disableNativeSavePicker(page);const editor=await bootEditor(page,'/embed/en/');await editor.locator('[data-aup4-input]').setInputFiles({name:'Automation.sscape',mimeType:'application/zip',buffer:Buffer.from(await blob.arrayBuffer())});await expect(editor).toHaveAttribute('data-project-id',project.id);
 await chooseCommandAction(page,editor,'Edit','Preferences');const preferences=page.getByRole('dialog',{name:'Editor preferences',exact:true});await preferences.getByRole('tab',{name:/Editing$/u}).click();await preferences.getByRole('checkbox',{name:'Always paste audio as a new clip',exact:true}).uncheck();await preferences.getByRole('button',{name:'Close',exact:true}).last().click();
 await chooseCommandAction(page,editor,'Select','Select all');const before=await exportSamples(page,editor);
 await range(page,editor,0,12000);await chooseCommandAction(page,editor,'Edit','Copy');await range(page,editor,24000,24000);await chooseNestedCommandAction(page,editor,'Edit',['Paste','Insert']);await expect(editor).toHaveAttribute('data-clip-count','1');
 const after=await exportSamples(page,editor);expect(after.length).toBe(60000);expect(after[10000]).toBeCloseTo(before[10000],5);expect(after[50000]).toBeCloseTo(before[38000],5);
 await chooseCommandAction(page,editor,'Edit','Undo');const undone=await exportSamples(page,editor);expect(undone.length).toBe(before.length);expect(undone[10000]).toBeCloseTo(before[10000],5);
 await chooseCommandAction(page,editor,'Edit','Redo');const redone=await exportSamples(page,editor);expect(redone.length).toBe(after.length);expect(redone[50000]).toBeCloseTo(after[50000],5);
});
