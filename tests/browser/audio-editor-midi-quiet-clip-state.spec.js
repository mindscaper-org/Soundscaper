/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, closeClipProperties, disableNativeSavePicker, downloadBytes, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { setClipTimeFrames } from './audio-editor-clip-timing-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { parseMidiFile, writeMidiFile } from '../../src/common/editor/midi-file.ts';
import { renderMidiFrames } from '../../src/common/editor/engine/midi-synthesis.ts';
const peak=values=>values.reduce((maximum,sample)=>Math.max(maximum,Math.abs(sample)),0);
for(const finalVolume of [0,127])test(`independent second clip keeps volume after first ends with CC7=${finalVolume}`,async({page})=>{
	await disableNativeSavePicker(page);const editor=await bootEditor(page,'/embed/en/', { showProjectBin: false });
	await chooseNestedCommandAction(page,editor,'Tracks',['Remove tracks']);
	const note={id:'n',pitch:69,channel:0,velocity:100,startFrame:0,durationFrames:24000};
	const file=(name,volume)=>({name:`${name}.mid`,mimeType:'audio/midi',buffer:Buffer.from(writeMidiFile({sampleRate:48000,tempos:[],signatures:[],tracks:[{name,notes:[note],durationFrames:name==='First'?48000:24000,...(volume===null?{}:{events:[{frame:0,status:176,data:[7,127]},{frame:36000,status:176,data:[7,volume]}]})}]}))});
	await importFiles(editor,[file('First',finalVolume),file('Second',null)]);await expect(editor).toHaveAttribute('data-clip-count','2');
	const second=clipByName(editor,'Second');const properties=await openClipProperties(page,editor,second,{additional:false});
	await setClipTimeFrames(properties,'startFrame',96000);await closeClipProperties(properties);
	await second.click({button:'right',position:{x:32,y:10}});
	const move=page.getByRole('menuitem',{name:/^Move to track \(preserve time\)/u});await move.hover();await move.getByRole('menuitem').first().click();
	await expect(clipByName(editor,'First').locator('xpath=ancestor::div[@data-track-row][1]').locator('[data-clip-id]')).toHaveCount(2);
	const before=await exportSamples(page,editor);expect(peak(before.slice(96000,120000))).toBeGreaterThan(.05);
	const downloading=page.waitForEvent('download');await chooseNestedCommandAction(page,editor,'File',['Export other','Export MIDI (beta)']);
	const download=await downloading;const delivered=parseMidiFile(await downloadBytes(download),{sampleRate:48000});await download.delete();
	const track=delivered.tracks.find(track=>track.notes.length);expect(track).toBeTruthy();
	expect((track.events??[]).filter(event=>event.frame===96000&&event.status===176&&event.data[0]===7).map(event=>event.data)).toEqual(finalVolume===0?[[7,127]]:[]);
	const actual=renderMidiFrames(track.notes,'triangle',48000,96000,24000,track.events);
	console.log('INDEPENDENT_CLIP_STATE',JSON.stringify({finalVolume,beforePeak:peak(before.slice(96000,120000)),deliveredPeak:peak(actual)}));
	expect(peak(actual)).toBeGreaterThan(.05);
});
