/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {scopePhotoCurrentV1} from './lightscaper-native-library-scope-integration-fixture-current.ts';
import type {TestContext} from 'node:test';
import {LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes} from '../../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import {LightscaperNativePhotoSessionServiceCurrentV1 as Main} from '../../desktop/lightscaper-native-photo-session-service-current-v1.ts';
import {createDesktopPhotoLibrarySessionServiceCurrentV1 as client} from '../../src/lightscaper/desktop-photo-library-session-client-current-v1.ts';
import {createDesktopPhotoLibrarySessionCurrentV1 as createSession} from '../../src/lightscaper/desktop-photo-library-session-runtime-current-v1.ts';
import {getDesktopPhotoLinkedLibraryCurrentV1 as linked} from '../../src/lightscaper/desktop-photo-linked-library-current-v1.ts';
import {DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 as channels} from '../../src/lightscaper/desktop-photo-library-session-protocol-current-v1.ts';
import type {PhotoLibrarySessionCurrentV1 as Session} from '../../src/lightscaper/controller/photo-library-session-current-v1.ts';
import {linkedGrantsFixtureCurrentV1 as native,grantedFsHashCurrentV1 as hash,LINKED_GRANT_TEST_OPTIONS_CURRENT_V1 as options,remainsPending} from './lightscaper-native-linked-grants-integration-fixture-current.ts';
import {originalGroupFixtureCurrentV1 as opfs} from './lightscaper-desktop-original-group-fixture-current.ts';
import {rawWorkerFixtureV1} from './lightscaper-raw-worker-current-fixture.ts';
export {linked,hash,options,remainsPending};
type Native=Parameters<Parameters<typeof native>[1]>[0];
export async function linkedWorkflowFixtureCurrentV1(context:TestContext,run:(f:Awaited<ReturnType<typeof create>>)=>Promise<void>):Promise<void>{
 await native(context,async base=>{const f=await create(context,base);let failed=false,primary:unknown;try{await run(f);}catch(error){failed=true;primary=error;}try{await f.close();}catch(cleanup){throw new AggregateError([...(failed?[primary]:[]),cleanup],'Linked complete Current workflow did not retire.',{cause:cleanup});}if(failed)throw primary;});
}
async function create(context:TestContext,base:Native){
 const binary=base.native.child.spawnargs[0];assert.ok(binary);const children=new Map<ChildProcessWithoutNullStreams,Promise<void>>(),storage=opfs(context),workers=await rawWorkerFixtureV1();
 const previousWorker=Object.getOwnPropertyDescriptor(globalThis,'Worker'),previousFetch=Object.getOwnPropertyDescriptor(globalThis,'fetch');let scopes:Scopes|undefined,main:Main|undefined;
 const sessions=new Set<Session>(),work=new Set<Promise<unknown>>(),controls=new Map<string,(kind:'stop'|'retire')=>Promise<void>>(),owner=Object.freeze({kind:'actual-linked-workflow-document'});
 let actualLease:Awaited<ReturnType<Scopes['openSessionLease']>>|undefined;
 let timer:ReturnType<typeof setTimeout>|undefined,expired=false,closing:Promise<void>|undefined;const failures:unknown[]=[];
 const release=():void=>{base.release();storage.stop.abort(context.signal.reason);};
 const cancel=():void=>{release();main?.stop(owner);for(const session of sessions)void session.close().catch(()=>undefined);};
 const kill=():void=>{cancel();for(const child of children.keys())if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');};
 const track=<Value>(accepted:Promise<Value>):Promise<Value>=>{work.add(accepted);void accepted.then(()=>{work.delete(accepted);},()=>{work.delete(accepted);});return base.track(accepted);};
 const close=():Promise<void>=>{if(closing)return closing;closing=Promise.resolve().then(async()=>{cancel();
  const results=await Promise.allSettled([...sessions].map(session=>session.close()));failures.push(...results.flatMap(value=>value.status==='rejected'?[value.reason as unknown]:[]));await Promise.allSettled([...work]);
  try{await main?.closeAll();}catch(error){failures.push(error);}for(const actual of[scopes,storage,workers])try{await actual?.close();}catch(error){failures.push(error);}
  for(const child of children.keys())if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await Promise.all(children.values());if(timer)clearTimeout(timer);context.signal.removeEventListener('abort',cancel);
  for(const [key,descriptor] of [['Worker',previousWorker],['fetch',previousFetch]] as const){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
  if(expired)failures.push(new Error('Linked workflow deadline actively retired native/browser work.'));if(failures.length)throw new AggregateError(failures,'Linked workflow actual cleanup failed.',{cause:failures[0]});});return closing;};
 try{const wasm=new Uint8Array(await readFile(new URL('../../runtime-assets/libraw/0.22.2/libraw.wasm',import.meta.url)));
  Object.defineProperty(globalThis,'Worker',{configurable:true,value:function(){return workers.createWorker();}});Object.defineProperty(globalThis,'fetch',{configurable:true,value:(value:RequestInfo|URL)=>{assert.equal(String(value),'https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm');return Promise.resolve(new Response(wasm));}});
  scopes=await Scopes.open({appDataPath:base.appDataPath,services:{chooseLinkedRoot:async()=>base.selected,startGrantedFilesystem(){const child=spawn(binary,[],{stdio:['pipe','pipe','pipe'],windowsHide:true});children.set(child,new Promise<void>(resolve=>{child.once('close',()=>{resolve();});}));return child;}}});const selected=await scopes.openSelected({name:'Actual linked workflow'});
  const descriptor=Object.getOwnPropertyDescriptor(Scopes.prototype,'openSessionLease');assert.ok(descriptor);const original=Scopes.prototype.openSessionLease,manager=scopes;
  try{Object.defineProperty(Scopes.prototype,'openSessionLease',{...descriptor,value:function(this:Scopes,...args:Parameters<Scopes['openSessionLease']>){return (Reflect.apply(original,this,args) as ReturnType<Scopes['openSessionLease']>).then(lease=>{if(this===manager)actualLease=lease;return lease;});}});main=new Main(scopes);}
  finally{Object.defineProperty(Scopes.prototype,'openSessionLease',descriptor);}const actualMain=main;
  const service=client({installRetirement(openId,handler){assert.equal(controls.has(openId),false);controls.set(openId,handler);return()=>{controls.delete(openId);};},async invoke(channel,payload){
   if(channel===channels.open){assert.ok(payload&&typeof payload==='object'&&'openId'in payload&&typeof payload.openId==='string');const retire=controls.get(payload.openId);assert.ok(retire);return actualMain.open(owner,payload,{close:()=>retire('retire')});}return actualMain.dispatch(channel,owner,payload);
  }});
  context.signal.addEventListener('abort',cancel,{once:true});timer=setTimeout(()=>{expired=true;kill();},12000);if(context.signal.aborted)cancel();
  return{...base,storage,workers,controls,track,release,scopeOwner:scopes,main,catalogId:selected.catalogId,
   get catalog(){assert.ok(actualLease);return actualLease.components.catalog;},get media(){assert.ok(actualLease);return actualLease.components.media;},get settings(){assert.ok(actualLease);return actualLease.components.settings;},
   peer(){return new DatabaseSync(base.mediaDatabasePath,{allowExtension:false,enableDoubleQuotedStringLiterals:false,timeout:50});},
   liveChildren:()=>[...children.keys()].filter(child=>child.exitCode===null&&child.signalCode===null).length,
   async open(){const session=await track(createSession({name:'Actual linked workflow',service,originalSourceOptions:{storage:storage.storage}}));sessions.add(session);await track(session.readPage());const runtime=linked(session);assert.ok(runtime);return{session,runtime};},
   async select(runtime:NonNullable<ReturnType<typeof linked>>,name='Workflow native.DNG'){
    const grant=await runtime.chooseFolder();assert.ok(grant);const scan=await runtime.openScan(grant.grantId);while(true){const page=await runtime.nextScan(scan),entry=page.entries.find(value=>value.displayName===name);if(entry)return{scan,entry};if(page.done)throw new Error('Actual linked workflow scan did not find its fixture.');}
   },
   async file(name='Workflow native.DNG'){const bytes=scopePhotoCurrentV1().bytes,file=join(base.rootPath,name);await writeFile(file,bytes);return{bytes,file};},close,
  };
 }catch(primary){try{await close();}catch(cleanup){throw new AggregateError([primary,cleanup],'Linked workflow opening and retirement failed.',{cause:cleanup});}throw primary;}
}
