/* SPDX-License-Identifier: AGPL-3.0-only */
import { unzipSync } from 'fflate';
import { expect,test } from './audio-editor-test-fixtures.js';
import {bootEditor,disableNativeSavePicker,openExportDialog,chooseDropdown,readDownloadBytes} from './audio-editor-test-helpers.js';
import {effectAutomationProject} from '../helpers/next-time-preserving-effect-project.ts';
import {createSoundscaperProject} from '../../src/soundscaper/editor-project.ts';
import {normalizeAutomationLaneV21} from '../../src/common/editor/automation-lane-v21.ts';
import {exportScapeProject} from '../../src/common/editor/scape-project.js';
import {createProjectStore} from '../../src/common/editor/storage.js';
for(const automated of [false,true])test(`Track stem bypasses its ${automated?'automated':'static'} mute`,async({page})=>{
 const base=effectAutomationProject();const project=createSoundscaperProject({...base.project,id:`stem-gate-${automated}`,tracks:base.project.tracks.map(track=>({...track,mute:!automated})),automationLanes:automated?[normalizeAutomationLaneV21({id:'mute-lane',address:{kind:'strip',strip:{kind:'track',id:'voice'},parameterId:'mute'},timebase:'absolute-samples',points:[{id:'muted',position:0,value:1}],segments:[]})]:[]});
 const store=createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `next-project-fixture-${crypto.randomUUID()}` });let blob;try{const writer=await store.beginSourceWrite(base.source.storageKey,base.source);await writer.write([base.samples]);await writer.commit();blob=(await exportScapeProject(project,store)).blob;}finally{await store.close();}
 await disableNativeSavePicker(page);const editor=await bootEditor(page,'/embed/en/');await editor.locator('[data-aup4-input]').setInputFiles({name:'Stems.sscape',mimeType:'application/zip',buffer:Buffer.from(await blob.arrayBuffer())});await expect(editor).toHaveAttribute('data-project-id',project.id);
 const dialog=await openExportDialog(page,editor);await chooseDropdown(page,dialog.locator('[data-export-field="output"]'),'Individual stems (split by tracks)');await dialog.getByRole('button',{name:'Export',exact:true}).click();const link=dialog.locator('[data-export-download]');await expect(link).toBeVisible();const entries=Object.entries(unzipSync(await readDownloadBytes(page,link)));expect(entries).toHaveLength(1);const samples=await page.evaluate(async bytes=>{const context=new AudioContext({sampleRate:48000});try{const decoded=await context.decodeAudioData(Uint8Array.from(bytes).buffer);return Array.from(decoded.getChannelData(0));}finally{await context.close();}},Array.from(entries[0][1]));expect(Math.max(...samples.slice(1000,30000))).toBeGreaterThan(.17);
});
