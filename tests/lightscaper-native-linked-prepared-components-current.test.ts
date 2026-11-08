/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {open} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes} from '../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import {nativeGrantedFilesystemFixtureCurrentV1 as fixture,grantedFsPathCurrentV1 as path} from './helpers/lightscaper-native-granted-filesystem-fixture-current.ts';
const options={timeout:15000,concurrency:false};
void test('Selected Components reprepare the actual one-use FS child per reopen and retire role before prepared artifact handles',options,async context=>fixture(context,async f=>{
 const binary=f.native.child.spawnargs[0];assert.ok(binary);const children=new Map<ChildProcessWithoutNullStreams,Promise<void>>(),prepared:Array<Readonly<{close():Promise<void>}>>=[],events:string[]=[];
 let scopes:Scopes|undefined,failed=false,primary:unknown,sequence=0;const failures:unknown[]=[];
 const kill=()=>{for(const child of children.keys())if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');};const timer=setTimeout(kill,13000);context.signal.addEventListener('abort',kill,{once:true});
 try{scopes=await Scopes.open({appDataPath:join(f.directory,'app-data'),services:{chooseLinkedRoot:async()=>({path:path(f.rootPath),displayName:'Real prepared folder'}),
  async prepareGrantedFilesystem({signal}){signal.throwIfAborted();const artifact=await open(binary,'r'),id=++sequence;let child:ChildProcessWithoutNullStreams|undefined,joined:Promise<void>|undefined,closing:Promise<void>|undefined,used=false;
   const owner=Object.freeze({start(){assert.equal(used,false);used=true;events.push(`start:${id}`);child=spawn(binary,[],{stdio:['pipe','pipe','pipe'],windowsHide:true});const actual=child;joined=new Promise<void>(resolve=>{actual.once('close',()=>{events.push(`child-close:${id}`);resolve();});});children.set(actual,joined);return actual;},
    close():Promise<void>{closing??=Promise.resolve().then(async()=>{const errors:unknown[]=[];if(child&&child.exitCode===null&&child.signalCode===null)errors.push(new Error('Prepared owner was closed before actual filesystem role retirement.'));
     if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await joined;try{await artifact.close();events.push(`artifact-close:${id}`);}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Prepared native FS did not retire in order.');});return closing;}});prepared.push(owner);return owner;
  }}});
  const selected=await scopes.openSelected({name:'Prepared actual native folder'});for(let pass=0;pass<2;pass++){const components:Awaited<ReturnType<Scopes['openComponents']>>=await scopes.openComponents(selected.scope);try{assert.ok(components.linked);assert.ok(await components.linked.grants.authorize());}finally{await components.close();}}
  assert.equal(sequence,2);for(let id=1;id<=2;id++)assert.ok(events.indexOf(`child-close:${id}`)>=0&&events.indexOf(`artifact-close:${id}`)>events.indexOf(`child-close:${id}`));
 }catch(error){failed=true;primary=error;}
 try{await scopes?.close();}catch(error){failures.push(error);}for(const owner of prepared)try{await owner.close();}catch(error){failures.push(error);}kill();await Promise.all(children.values());clearTimeout(timer);context.signal.removeEventListener('abort',kill);
 if(failures.length)throw new AggregateError([...(failed?[primary]:[]),...failures],'Prepared FS Components test did not join native work.',{cause:failures[0]});if(failed)throw primary;
}));
void test('Native Services refuses two FS starter modes before either trusted callback runs',options,async context=>fixture(context,async f=>{
 let calls=0;await assert.rejects(Scopes.open({appDataPath:join(f.directory,'app-data'),services:{startGrantedFilesystem(){calls++;throw new Error('Unexpected sync start.');},prepareGrantedFilesystem:async()=>{calls++;throw new Error('Unexpected prepare.');},chooseLinkedRoot:async()=>null}}));assert.equal(calls,0);
}));
