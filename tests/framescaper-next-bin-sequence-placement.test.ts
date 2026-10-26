/* SPDX-License-Identifier: AGPL-3.0-only */
import {MockAudioContext} from './helpers/mock-audio-context.js';
import assert from 'node:assert/strict';import test from 'node:test';
import {createFramescaperEditorProjectEnvironment} from '../src/framescaper/editor-project-environment.ts';
import {createFramescaperAudioEditorController} from '../src/framescaper/editor-controller.ts';
import {createFramescaperProject,validateFramescaperProject} from '../src/framescaper/editor-project.ts';
import {FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE} from '../src/framescaper/editor-project-runtime-profile.ts';
import {createFramescaperScapeNativeRuntime} from '../src/framescaper/editor-scape-native.ts';
import {createAudioClip,createAudioSource,createAudioTrack} from '../src/common/editor/project-media-factory.ts';
import {createInstrumentedIndexedDB} from './helpers/instrumented-indexeddb.js';
for (const existing of [false, true]) test(`NP048: Bin placement retains the focused secondary sequence; existing audio=${existing}`,async context=>{
 const prior=globalThis.AudioContext;globalThis.AudioContext=MockAudioContext as unknown as typeof AudioContext;context.after(()=>{globalThis.AudioContext=prior;}); const environment=await createFramescaperEditorProjectEnvironment({storeOptions:{indexedDB:createInstrumentedIndexedDB() as unknown as IDBFactory,preferOpfs:false}});const controller=createFramescaperAudioEditorController(environment);context.after(async()=>{await controller.dispose();await environment.close();});await controller.ready;
 const source=createAudioSource({id:'tone',name:'Tone',sampleRate:48000,channelCount:1,frameCount:4800});const writer=await environment.store.beginSourceWrite(source.storageKey,source);await writer.write([new Float32Array(4800).fill(.25)]);await writer.commit();
 const project=createFramescaperProject(PROFILE,{id:'bin-sequences',sources:[source],tracks:[{id:'main-labels',name:'Main',type:'label',labels:[]},{id:'cut-labels',name:'Cut',type:'label',labels:[]},...(existing?[createAudioTrack({id:'own-audio',name:'Own audio'})]:[])],projectBin:{clips:[createAudioClip({id:'bin',binItemId:'tone-item',title:'Tone',sourceId:source.id,durationFrames:4800,sourceDurationFrames:4800})]},sequences:[{id:'main',trackIds:['main-labels']},{id:'cut',trackIds:['cut-labels',...(existing?['own-audio']:[])]}],primarySequenceId:'main'});
 const archive=await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project,environment.store);assert.ok(archive.blob instanceof Blob);await controller.actions.project.openScapeFile(new File([archive.blob],'Bin.fscape'),()=> 'copy');assert.equal(controller.getSnapshot().readOnly,false);controller.actions.timeline.selectTrack(existing?'own-audio':'cut-labels');const before=controller.project;const clipId=controller.actions.projectBin.place('bin');
 const after:unknown=controller.project;assert.ok(validateFramescaperProject(PROFILE,after));
 const track=records(after.tracks).find(track=>Array.isArray(track.clipIds)&&track.clipIds.includes(clipId));assert.ok(track);
 const sequence=records(after.sequences).find(sequence=>sequence.id==='cut');assert.ok(sequence&&Array.isArray(sequence.trackIds));assert.ok(sequence.trackIds.includes(track.id));
 assert.equal(records(after.tracks).length,3);if(existing)assert.equal(track.id,'own-audio');
 controller.actions.edit.undo();assert.deepEqual(controller.project?.tracks,before?.tracks);assert.deepEqual(controller.project?.clips,before?.clips);assert.deepEqual(controller.project?.sequences,before?.sequences);
 controller.actions.edit.redo();assert.deepEqual(controller.project?.tracks,after.tracks);assert.deepEqual(controller.project?.clips,after.clips);assert.deepEqual(controller.project?.sequences,after.sequences);
});
function records(value:unknown):readonly Readonly<Record<string,unknown>>[]{assert.ok(Array.isArray(value));const rows:unknown[]=value;return rows.map(value=>{assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));return value as Readonly<Record<string,unknown>>;});}
