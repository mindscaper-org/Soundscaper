/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, closeClipProperties, disableNativeSavePicker, downloadBytes, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { setClipTimeFrames } from './audio-editor-clip-timing-test-helpers.js';
import { parseMidiFile, writeMidiFile } from '../../src/common/editor/midi-file.ts';

for (const trim of [0, 12000]) test(`pending lyric prefix after actual left trim ${trim}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const bytes = writeMidiFile({sampleRate:48000,tempos:[{frame:0,bpm:120}],signatures:[],tracks:[{name:'Scoped lyric',durationFrames:96000,
	 notes:[{id:'n',startFrame:48000,durationFrames:24000,channel:2,pitch:60,velocity:90}],events:[{frame:0,status:255,metaType:32,data:[2]},{frame:24000,status:255,metaType:5,data:[104,105]}]}]});
	await importFiles(editor,[{name:'Scoped lyric.mid',mimeType:'audio/midi',buffer:Buffer.from(bytes)}]);
	if(trim){const properties=await openClipProperties(page,editor,clipByName(editor,'Scoped lyric'),{additional:false});await setClipTimeFrames(properties,'sourceInFrame',trim);await closeClipProperties(properties);}
	const downloading=page.waitForEvent('download');await chooseNestedCommandAction(page,editor,'File',['Export other','Export MIDI (beta)']);
	const download=await downloading;const output=await downloadBytes(download);await download.delete();
	const events=parseMidiFile(output,{sampleRate:48000}).tracks.flatMap(track=>track.events??[]);
	expect(events.filter(event=>event.metaType===5).map(event=>event.data)).toEqual([[104,105]]);
	expect(events.filter(event=>event.metaType===32).map(event=>event.data)).toEqual([[2]]);
});


test('same-tick raw NoteOn retirement cannot become channel-scoped delivered lyrics', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	const track = [0,255,81,3,7,161,32,0,255,32,1,2,0,0x92,60,90,0,255,5,2,104,105,0x83,0x60,0x82,60,0,0,255,47,0];
	const input = Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224,77,84,114,107,0,0,0,track.length,...track]);
	await importFiles(editor,[{name:'Global after onset.mid',mimeType:'audio/midi',buffer:Buffer.from(input)}]);
	const downloads=[];page.on('download',download=>downloads.push(download));
	await chooseNestedCommandAction(page,editor,'File',['Export other','Export MIDI (beta)']);
	await expect(page.locator('[data-editor-toast="workspace-error"]')).toContainText('MIDI text channel association cannot be cleared');
	expect(downloads).toHaveLength(0);
	await expect(editor).toHaveAttribute('data-clip-count','1');
});
