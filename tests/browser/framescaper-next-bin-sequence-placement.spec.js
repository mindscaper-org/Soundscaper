/* SPDX-License-Identifier: AGPL-3.0-only */
import {expect,test} from './audio-editor-test-fixtures.js';
import {bootEditor,chooseNestedCommandAction,chooseCommandAction,waitForProjectActivation} from './audio-editor-test-helpers.js';
import {createFramescaperProject} from '../../src/framescaper/editor-project.ts';
import {FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE} from '../../src/framescaper/editor-project-runtime-profile.ts';
import {createFramescaperScapeNativeRuntime} from '../../src/framescaper/editor-scape-native.ts';
import {createAudioClip,createAudioSource} from '../../src/common/editor/project-media-factory.ts';
import {createProjectStore} from '../../src/common/editor/storage.js';
test('Bin Add audio creates its track next to the focused secondary label',async({page})=>{
 const source=createAudioSource({id:'tone',name:'Tone',sampleRate:48000,channelCount:1,frameCount:4800});
 const project=createFramescaperProject(PROFILE,{id:'bin-sequences',sources:[source],tracks:[{id:'main-labels',name:'Main',type:'label',labels:[]},{id:'cut-labels',name:'Cut',type:'label',labels:[]}],projectBin:{clips:[createAudioClip({id:'bin',binItemId:'tone-item',title:'Tone',sourceId:source.id,durationFrames:4800,sourceDurationFrames:4800})]},sequences:[{id:'main',trackIds:['main-labels']},{id:'cut',trackIds:['cut-labels']}],primarySequenceId:'main'});
 const store=createProjectStore({indexedDB:null,preferOpfs:false});let blob;try{const writer=await store.beginSourceWrite(source.storageKey,source);await writer.write([new Float32Array(4800).fill(.25)]);await writer.commit();blob=(await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project,store)).blob;}finally{await store.close();}
 const editor=await bootEditor(page,'/framescaper/embed/en/');await editor.locator('[data-aup4-input]').setInputFiles({name:'Bin.fscape',mimeType:'application/zip',buffer:Buffer.from(await blob.arrayBuffer())});await expect(editor).toHaveAttribute('data-project-id',project.id);await expect(editor).not.toHaveAttribute('data-edit-block-reason','read-only');await waitForProjectActivation(editor);
 await editor.locator('[data-label-track][data-track-id="cut-labels"] [data-track-name]').click();await expect(editor.locator('[data-label-track][data-track-id="cut-labels"] [data-track-header]')).toHaveAttribute('data-selected','true');if(!await editor.locator('[data-workspace-panel="project-bin"]').isVisible())await chooseNestedCommandAction(page,editor,'Window',['Project bin']);await editor.locator('[data-project-bin-item="tone-item"]').getByRole('button',{name:'Add to timeline: Tone',exact:true}).click();
 const rows=editor.locator('[data-track-row]');await expect(rows).toHaveCount(3);await expect(rows.nth(2)).toHaveAttribute('data-track-id',/^track-/u);await expect(rows.nth(1)).toHaveAttribute('data-track-id','cut-labels');await chooseCommandAction(page,editor,'Edit','Undo');await expect(rows).toHaveCount(2);await chooseCommandAction(page,editor,'Edit','Redo');await expect(rows).toHaveCount(3);await expect(rows.nth(1)).toHaveAttribute('data-track-id','cut-labels');
});
