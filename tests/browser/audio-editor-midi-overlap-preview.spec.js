/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('finishing an earlier MIDI note publication keeps the newer held drag preview',async({page})=>{
	await page.addInitScript(()=>{globalThis.__midiGateEntered=false;globalThis.__midiGatePublished=false;});
	await page.route(/\/midi-service-[^/]+\.js$/u,async route=>{
		const response=await route.fetch(),body=await response.text();
		const factory=body.match(/([\w$]+)\s+as\s+createMidiService/u);expect(factory).not.toBeNull();
		const observed=body.replace(factory[0],'observedMidiFactory as createMidiService')+`\nconst observedMidiFactory=(...ports)=>{const service=${factory[1]}(...ports);let calls=0;return {...service,async updateNotes(...args){const ordinal=++calls;if(ordinal===1){globalThis.__midiGateEntered=true;await new Promise(resolve=>{globalThis.__releaseMidiGate=resolve;});}const result=await service.updateNotes(...args);if(ordinal===1)globalThis.__midiGatePublished=true;return result;}};};`;
		await route.fulfill({response,body:observed});
	});
	const editor=await bootEditor(page,'/embed/en/');
	await chooseNestedCommandAction(page,editor,'Tracks',['Add new track','MIDI track (beta)']);
	await chooseNestedCommandAction(page,editor,'Window',['Piano roll (beta)']);
	const panel=editor.getByLabel('Piano roll (beta)',{exact:true});
	await panel.getByRole('button',{name:'Add note',exact:true}).click();
	const note=panel.locator('.note-rect[data-note-id="1"]');await expect(note).toBeVisible();
	let box=await note.boundingBox();expect(box).not.toBeNull();
	let x=box.x+box.width/2,y=box.y+box.height/2;
	try{
		await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+25,y,{steps:3});await page.mouse.up();
		await expect.poll(()=>page.evaluate(()=>globalThis.__midiGateEntered)).toBe(true);
		await expect(note).toHaveCSS('left','25px');
		box=await note.boundingBox();x=box.x+box.width/2;y=box.y+box.height/2;
		await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+25,y,{steps:3});
		await expect(note).toHaveCSS('left','50px');
		await page.evaluate(()=>globalThis.__releaseMidiGate());
		await expect.poll(()=>page.evaluate(()=>globalThis.__midiGatePublished)).toBe(true);
		await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
		await expect(note).toHaveCSS('left','50px');
	}finally{await page.evaluate(()=>globalThis.__releaseMidiGate?.());await page.mouse.up();}
});
