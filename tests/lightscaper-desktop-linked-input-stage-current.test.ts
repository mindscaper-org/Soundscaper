/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { linkedInputStageFixtureCurrentV1 as fixture,options,hash,remainsPending,GRANTED_FS_OP as OP,CATALOG } from './helpers/lightscaper-native-linked-input-stage-integration-fixture-current.ts';
import { preparePhotoImportGestureCurrentV1 } from '../src/lightscaper/import/photo-import-preparation-current-v1.ts';
import { withDecodedRawOriginalV1 } from '../src/common/editor/raw/libraw-runtime-v1.ts';
import { compilePinnedLibRawModuleV1 } from '../src/common/editor/raw/libraw-runtime-asset-v1.ts';
import { rawWorkerFixtureV1 } from './helpers/lightscaper-raw-worker-current-fixture.ts';
let compiled:Promise<WebAssembly.Module>|undefined;
function moduleBytes(){compiled??=readFile(new URL('../runtime-assets/libraw/0.22.2/libraw.wasm',import.meta.url)).then(bytes=>compilePinnedLibRawModuleV1(new Uint8Array(bytes)));return compiled;}
void test('Linked native input materializes a genuine File and retains actual Main file until explicit stage lease close',options,async context=>fixture(context,async f=>{
 const e=await f.write(),{input,lease}=await f.acquire();assert.ok(lease.body instanceof File);assert.equal(lease.body.size,e.bytes.byteLength);assert.equal(hash(new Uint8Array(await lease.body.arrayBuffer())),hash(e.bytes));assert.equal(lease.facts.contentSha256,hash(e.bytes));assert.equal(f.handles.count,1);
 const closing=f.source.close();assert.equal(await remainsPending(closing),true);assert.equal(f.opfs.counts().stages,1);await lease.close();await closing;assert.equal(f.opfs.counts().stages,0);assert.equal(f.handles.count,0);await assert.rejects(f.source.acquire(input));
}));
void test('Linked stage close joins held actual writable before deleting storage or releasing its Main input',options,async context=>fixture(context,async f=>{
 await f.write();const selected=await f.open('Selected native.DNG'),release=f.opfs.gate();f.opfs.hooks.write=()=>release.promise;const accepted=f.track(f.source.acquire(selected));let closing:Promise<void>|undefined;
 try{await f.opfs.reached('write-start',accepted);closing=f.source.close();assert.equal(await remainsPending(closing),true);assert.equal(f.opfs.events.includes('remove-start'),false);release.release();await Promise.allSettled([accepted]);await closing;assert.equal(f.handles.count,0);assert.equal(f.opfs.counts().stages,0);}
 finally{release.release();await Promise.allSettled([accepted,...(closing?[closing]:[])]);}
}));
void test('Linked stage caller cancellation joins held genuine native pull and closes its unpublished input',options,async context=>fixture(context,async f=>{
 await f.write();const selected=await f.open('Selected native.DNG'),gate=f.holdNext(OP.read),stop=new AbortController(),reason=Symbol('linked OPFS acquisition stopped'),accepted=f.track(f.source.acquire(selected,{signal:stop.signal}));
 try{await f.reached(gate.entered,accepted);stop.abort(reason);assert.equal(await remainsPending(accepted),true);gate.release();await accepted.then(()=>assert.fail('Canceled genuine File was delivered.'),error=>{assert.equal(error,reason);});assert.equal(f.handles.count,0);assert.equal(f.opfs.counts().stages,0);}
 finally{gate.release();await Promise.allSettled([accepted]);}
}));
void test('Current preparation decodes real RAW File while linked stage/native file remain held and joins the actual worker',options,async context=>fixture(context,async f=>{
 const e=await f.write(),{lease}=await f.acquire(),workers=await rawWorkerFixtureV1(),root=await f.catalog.loadCatalog(CATALOG);assert.ok(root);
 const stream=preparePhotoImportGestureCurrentV1({files:[lease.body],catalog:root,createdAt:'2026-10-18T00:00:00.000Z',signal:f.scope.signal,
  ownership:[{photoId:'real-linked-preparation',originalId:'real-linked-source',originalStorageKey:lease.facts.sourceId,masterVersionId:'real-linked-master'}]},
  {withRawFrame:(value,consume)=>withDecodedRawOriginalV1(value,consume,{loadModule:moduleBytes,createWorker:workers.createWorker})});
 let failed=false,primary:unknown;
 try{const outcome=await f.track(stream.next());assert.equal(outcome.done,false);assert.ok(outcome.value?.outcome==='prepared');assert.equal(outcome.value.photo.original.contentSha256,hash(e.bytes));assert.equal(outcome.value.photo.original.width,e.photo.original.width);assert.equal(outcome.value.photo.original.height,e.photo.original.height);assert.equal(outcome.value.photo.original.storageKey,lease.facts.sourceId);assert.equal(workers.active(),0);assert.equal(workers.statistics.created,1);assert.equal(f.handles.count,1);}
 catch(error){failed=true;primary=error;}
 const errors:unknown[]=[];try{await stream.return(undefined);}catch(error){errors.push(error);}try{await workers.close();}catch(error){errors.push(error);}try{await lease.close();}catch(error){errors.push(error);}
 if(errors.length)throw new AggregateError([...(failed?[primary]:[]),...errors],'Actual linked RAW preparation retirement failed.',{cause:errors[0]});if(failed)throw primary;
}));
