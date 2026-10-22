/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, {type TestContext} from 'node:test';
import {createHash} from 'node:crypto';
import type {TrimMediaFfmpegRuntime} from '../src/common/editor/controller/document/trim-media-service.ts';
import {createFramescaperEditorProjectEnvironment} from '../src/framescaper/editor-project-environment.ts';
import {createFramescaperProject} from '../src/framescaper/editor-project.ts';
import {FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE} from '../src/framescaper/editor-project-runtime-profile.ts';
import {createFramescaperScapeNativeRuntime} from '../src/framescaper/editor-scape-native.ts';
import {createAudioEditorController} from '../src/common/editor/app.js';
import {createVideoSource,createVideoClip,createVideoTrack} from '../src/common/editor/project-media-factory.ts';
import {createInstrumentedIndexedDB} from './helpers/instrumented-indexeddb.js';
import {COPY,createMemoryEngine} from './helpers/audio-editor-controller-harness.js';
import {createMemoryFfmpeg} from './helpers/audio-editor-controller-fixtures.js';
type Options=NonNullable<Parameters<typeof createAudioEditorController>[1]>;
function ffmpeg(){const files=new Map<string,Uint8Array>();return {...createMemoryFfmpeg(),async runTrimMediaOperation<T>(operation:(lease:TrimMediaFfmpegRuntime)=>Promise<T>){return operation({
 async writeInput(bytes:Uint8Array){files.set('in',bytes);return 'in';},async writeText(){},
 async exec(args:readonly string[]){if(args.some(x=>x.includes('showinfo')))return {exitCode:0,logs:Array.from({length:300},(_,n)=>`[Parsed_showinfo_0 @ 0x1] n:${n} pts:${n} iskey:${n%10===0?1:0}`)};files.set(args.at(-1)!,Uint8Array.of(4,5,6));return {exitCode:0,logs:[]};},
 async readOutput(path:string){return files.get(path)!;},async deletePath(path:string){files.delete(path);}
 });}}}
async function fixture(context:TestContext){
 const environment=await createFramescaperEditorProjectEnvironment({storeOptions:{indexedDB:createInstrumentedIndexedDB() as unknown as IDBFactory,preferOpfs:false,storageManager:{estimate:async()=>({usage:0,quota:1024**3}),persisted:async()=>true,persist:async()=>true} as unknown as StorageManager}});
 const store=environment.store,archive=createFramescaperScapeNativeRuntime(PROFILE);
 const controller=createAudioEditorController(null,{headless:true,productId:'framescaper',copy:COPY,locale:'en',store:environment.controllerStore,projectRuntime:environment.runtime,sessionController:environment.runtime.createSessionController(),acquireProjectLock:environment.runtime.acquireProjectLock,playbackProjectService:environment.playback,scapeProjectRuntime:archive,engine:createMemoryEngine() as unknown as Options['engine'],ffmpeg:ffmpeg() as unknown as Options['ffmpeg']});
 context.after(async()=>{await controller.dispose();await environment.close()});await controller.ready;
 const sequence={id:'main',rate:{num:30,den:1}},source=createVideoSource({id:'video',storageKey:'video',mimeType:'video/mp4',name:'Original.mp4',frameCount:480_000,sampleRate:48_000,sourceFrameCount:300,frameRate:sequence.rate,width:640,height:360,videoCodec:'h264',audioCodec:null,hasAudio:false,timingDecision:{mode:'conform-cfr-at-ingest',rate:sequence.rate,reason:'timing-probe-unavailable',failures:[]}});
 const clip=createVideoClip({id:'clip',sourceId:source.id,sequenceId:sequence.id,sequenceStartFrame:0,sequenceFrameCount:60,sourceInFrame:123,sourceFrameCount:60},{projectSampleRate:48_000,sequence,source});
 const project=createFramescaperProject(PROFILE,{id:'repeat-trim',sequences:[sequence],primarySequenceId:sequence.id,sources:[source],clips:[clip],tracks:[createVideoTrack({id:'video-track',sequenceId:sequence.id,clipIds:['clip']})]});
 await store.writeMediaAsset('video',new Blob([Uint8Array.of(1,2,3)],{type:'video/mp4'}),{mimeType:'video/mp4'});
 const exported=await archive.exportScapeProject(project,store);assert.ok(exported.blob instanceof Blob);
 await controller.actions.project.openScapeFile(new File([exported.blob],'Original.fscape'),()=> 'copy');
 assert.equal(controller.getSnapshot().readOnly,false);
 return {controller,store};
}

test('NP060: native File Open then Trim, Undo and Trim reuses exact immutable media',async context=>{
 const {controller,store}=await fixture(context);
 const before=controller.project;
 const first=await controller.actions.media.trim();assert.equal(first?.run.trimmedSources,1,JSON.stringify(first?.report));
 const trimmed=controller.project;
 assert.notDeepEqual(trimmed,before);
 controller.actions.edit.undo();assert.deepEqual(controller.project?.clips,before?.clips);assert.deepEqual(controller.project?.sources,before?.sources);
 const second=await controller.actions.media.trim();assert.equal(second?.run.trimmedSources,1,JSON.stringify(second?.report));
 assert.equal(second?.complete,true);
 assert.deepEqual(controller.project?.clips,trimmed?.clips);
 const key=second?.run.sources[0]?.storageKey;assert.equal(typeof key,'string');
 assert.deepEqual(new Uint8Array(await (await store.loadMediaAsset(key!))!.arrayBuffer()),Uint8Array.of(4,5,6));
 controller.actions.edit.undo();assert.deepEqual(controller.project?.clips,before?.clips);assert.deepEqual(controller.project?.sources,before?.sources);
 controller.actions.edit.redo();assert.deepEqual(controller.project?.clips,trimmed?.clips);
});

for(const wrong of [Uint8Array.of(9,8,7),Uint8Array.of(4,5)])test(`NP060: conflicting ${wrong.length}-byte immutable trim body is preserved and refused`,async context=>{
 const {controller,store}=await fixture(context);
 const before=controller.project;assert.ok(before);
 const source=before.sources.find(source=>source.kind==='video');assert.ok(source);
 const digest=createHash('sha256').update(Uint8Array.of(4,5,6)).digest('hex');
 const key=`${source.id}.trim.${digest.slice(0,16)}`;
 await store.writeMediaAsset(key,new Blob([wrong]),{});
 const result=await controller.actions.media.trim();
 assert.equal(result?.complete,false);assert.equal(result?.run.trimmedSources,0);
 assert.deepEqual(controller.project,before);
 assert.deepEqual(new Uint8Array(await (await store.loadMediaAsset(key))!.arrayBuffer()),wrong);
});
