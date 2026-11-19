/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkedSessionFixtureCurrentV1 as fixture,options,GRANTED_FS_OP as OP,remainsPending,hash } from './helpers/lightscaper-native-linked-session-integration-fixture-current.ts';
void test('Linked Session close joins held actual input read and native file close before retiring handles',options,async context=>fixture(context,async f=>{
 const e=await f.write(),selected=await f.open('Selected native.DNG'),gate=f.holdNext(OP.read),reading=f.run({operation:'input-read',handle:selected.handle,offset:0,length:e.bytes.byteLength});let closing:Promise<unknown>|undefined;
 try{await f.reached(gate.entered,reading);closing=f.owner.close();assert.equal(await remainsPending(closing),true);assert.ok(f.handles.count>0);gate.release();await Promise.allSettled([reading]);await closing;assert.equal(f.handles.count,0);}
 finally{gate.release();await Promise.allSettled([reading,...(closing?[closing]:[])]);}
}));
void test('Linked Session unpublished input acquisition canceled during actual open is joined and never delivered',options,async context=>fixture(context,async f=>{
 await f.write();const chosen=await f.pick('Selected native.DNG'),gate=f.holdNext(OP.fileOpen),stop=new AbortController(),reason=Symbol('local linked cancel');const accepted=f.run({operation:'input-open',scan:chosen.scan,entryId:chosen.entry.entryId},stop.signal);let failed=false;
 try{await f.reached(gate.entered,accepted);stop.abort(reason);assert.equal(await remainsPending(accepted),true);gate.release();await accepted.then(()=>assert.fail('Canceled actual input was delivered.'),error=>{failed=true;assert.equal(error,reason);});assert.equal(failed,true);assert.equal(f.handles.count,1);await f.closeScan(chosen.scan);}
 finally{gate.release();await Promise.allSettled([accepted]);}
}));
void test('Linked Session cleanup is callable after selected stop and other methods refuse before borrowed packet reflection',options,async context=>fixture(context,async f=>{
 await f.write();const selected=await f.open('Selected native.DNG'),reason=new Error('selected generation stopping');f.controller.abort(reason);let reflected=0;
 const poison=new Proxy({}, {ownKeys(){reflected++;throw new Error('Borrowed packet reflected after stop.');},get(){reflected++;throw new Error('Borrowed packet reflected after stop.');}});
 await assert.rejects(f.owner.execute(poison));assert.equal(reflected,0);await f.owner.execute({operation:'input-close',handle:selected.handle});await f.owner.close();assert.equal(f.handles.count,0);
}));
void test('Linked Session retained RAW input borrow keeps actual native file through callback and expires escaped reads',options,async context=>fixture(context,async f=>{
 const e=await f.write(),selected=await f.open('Selected native.DNG'),entered=f.gate(),release=f.gate();let read:((offset:number,length:number)=>Promise<Uint8Array>)|undefined;
 const using=f.track(f.owner.withInput(selected.handle,async view=>{read=view.read;assert.equal(view.contentSha256,hash(e.bytes));assert.equal(hash(await view.read(0,e.bytes.byteLength)),hash(e.bytes));entered.release();await release.promise;}));let closing:Promise<unknown>|undefined;
 try{await f.reached(entered.promise,using);closing=f.owner.execute({operation:'input-close',handle:selected.handle});assert.equal(await remainsPending(closing),true);release.release();await using;await closing;assert.ok(read);const before=f.count(OP.read);await assert.rejects(read(0,1));assert.equal(f.count(OP.read),before);}
 finally{release.release();await Promise.allSettled([using,...(closing?[closing]:[])]);}
}));
void test('Linked Session wire rejects a renderer-provided native proof object and a foreign purpose handle',options,async context=>fixture(context,async f=>{
 const e=await f.write();await assert.rejects(f.run({operation:'input-read',handle:e.input,offset:0,length:1}));await assert.rejects(f.run({operation:'input-read',handle:{kind:'upload',id:'a'.repeat(64)},offset:0,length:1}));
 await assert.rejects(f.run({operation:'input-open',scan:{kind:'linked-scan',id:'a'.repeat(64)},entryId:'b'.repeat(64)}));assert.equal(f.handles.count,0);
}));
