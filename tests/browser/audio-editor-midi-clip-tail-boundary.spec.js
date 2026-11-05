/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { midiServiceFixture } from '../helpers/midi-service-fixture.ts';
import { parseMidiFile, writeMidiFile } from '../../src/common/editor/midi-file.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

async function nativeGap(release) {
	const f=midiServiceFixture();
	const [created]=await f.service.importDocument(parseMidiFile(writeMidiFile({sampleRate:8000,tempos:[{frame:0,bpm:120}],signatures:[],tracks:[{name:'Pedal',durationFrames:16000,
	notes:[{id:'note',channel:0,pitch:69,velocity:100,startFrame:0,durationFrames:2000}],
	events:[{frame:0,status:176,data:[64,127]},{frame:release,status:176,data:[64,0]}]}]}),{sampleRate:8000}));
	assert.ok(created); await f.service.resizeClip(created.clipId,{timelineStartFrame:0,sourceStartFrame:0,durationFrames:4000});
	const first=f.project().clips[0]; assert.ok(first);
	f.apply({type:'clip/add',trackId:created.trackId,clip:{...first,id:'second-copy',timelineStartFrame:16000}});
	const original=f.project();
	const project=createSoundscaperProject({id:`pedal-gap-${release}`,sampleRate:8000,sources:original.sources,clips:original.clips,tracks:original.tracks});
	const store=createProjectStore({indexedDB:null,preferOpfs:false,databaseName:crypto.randomUUID()});
	try {
	 for(const source of project.sources){const writer=await store.beginSourceWrite(source.storageKey,source);for(const chunk of f.pcm.get(source.id)??[])await writer.write([chunk]);await writer.commit();}
	 const archive=await exportScapeProject(project,store);assert.ok(archive.blob);
	 return {name:'Pedal-gap.sscape',mimeType:'application/zip',buffer:Buffer.from(await archive.blob.arrayBuffer())};
	} finally {await store.close();}
}
for (const release of [3000,12000]) test(`MIDI export keeps a real inter-clip silent gap with pedal release ${release}`,async({page})=>{
	await disableNativeSavePicker(page);const editor=await bootEditor(page,'/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(await nativeGap(release));
	await expect(editor).toHaveAttribute('data-clip-count','2');
	const before=await exportSamples(page,editor);
	const beforePeak=before.slice(48000,54000).reduce((peak,value)=>Math.max(peak,Math.abs(value)),0);
	expect(beforePeak).toBeLessThan(.0001);
	if (release === 12000) {
	 const downloads = [];
	 page.on('download', download => downloads.push(download));
	 await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export MIDI (beta)']);
	 await expect(page.locator('[data-editor-toast="workspace-error"]')).toContainText('sustained note cut by a clip boundary');
	 expect(downloads).toHaveLength(0);
	 await expect(editor).toHaveAttribute('data-clip-count', '2');
	 return;
	}
	const downloading=page.waitForEvent('download');await chooseNestedCommandAction(page,editor,'File',['Export other','Export MIDI (beta)']);
	const download=await downloading;const bytes=await downloadBytes(download);await download.delete();
	const document=parseMidiFile(bytes,{sampleRate:8000});
	const track=document.tracks.find(track=>track.notes.length);expect(track.notes).toHaveLength(2);expect(track.durationFrames).toBe(20000);
	await importFiles(editor,[{name:'Delivered-gap.mid',mimeType:'audio/midi',buffer:Buffer.from(bytes)}]);
	await expect(editor).toHaveAttribute('data-clip-count','3');
	const after=await exportSamples(page,editor);
	const afterPeak=after.slice(48000,54000).reduce((peak,value)=>Math.max(peak,Math.abs(value)),0);
	console.log({release,beforePeak,afterPeak,deliveredEnd:track.durationFrames});
	expect(afterPeak,'delivered MIDI must preserve the authored silent gap between clips').toBeLessThan(.0001);
});
