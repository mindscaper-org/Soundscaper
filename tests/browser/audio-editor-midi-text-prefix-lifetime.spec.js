/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, closeClipProperties, disableNativeSavePicker, downloadBytes, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { setClipTimeFrames } from './audio-editor-clip-timing-test-helpers.js';
import { parseMidiFile, writeMidiFile } from '../../src/common/editor/midi-file.ts';

// Literal lyric scope and refusal have actual controller/archive custody in
// audio-editor-midi-{chronology,refusal}-archive-custody.test.ts. Keep native trim integration.
for (const trim of [12000]) test(`pending lyric prefix after actual left trim ${trim}`, async ({ page }) => {
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
