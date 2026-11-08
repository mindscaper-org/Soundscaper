/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {DesktopPhotoSessionClientCallsCurrentV1 as Calls} from '../src/lightscaper/desktop-photo-library-session-client-calls-current-v1.ts';
import {createDesktopPhotoLinkedLibraryPortCurrentV1 as client} from '../src/lightscaper/desktop-photo-library-session-linked-client-current-v1.ts';
import {DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 as channels} from '../src/lightscaper/desktop-photo-library-session-protocol-current-v1.ts';
import {linkedSessionFixtureCurrentV1 as native,options,CATALOG,photo,hash} from './helpers/lightscaper-native-linked-session-integration-fixture-current.ts';
type Native=Parameters<Parameters<typeof native>[1]>[0];
type Hook=(operation:string,result:unknown)=>Promise<void>|void;
async function fixture(context:TestContext,run:(f:Native,c:Calls,port:ReturnType<typeof client>,hooks:{reply?:Hook})=>Promise<void>):Promise<void>{
 await native(context,async f=>{const controller=new AbortController(),hooks:{reply?:Hook}={},work=new Map<number,AbortController>();
  const c=new Calls({schemaVersion:1,kind:'desktop-photo-session',profile:'current3',sessionId:'a'.repeat(64),catalogId:CATALOG,selectionToken:'b'.repeat(32)},controller,async(channel,envelope)=>{
   assert.ok(envelope&&typeof envelope==='object'&&'identity'in envelope&&'payload'in envelope);const identity=envelope.identity,payload=envelope.payload;assert.ok(identity&&typeof identity==='object'&&'requestId'in identity&&typeof identity.requestId==='number');
   if(channel===channels.cancel){assert.ok(payload&&typeof payload==='object'&&'requestId'in payload&&typeof payload.requestId==='number');work.get(payload.requestId)?.abort(new DOMException('Actual linked call cancelled.','AbortError'));return;}
   assert.equal(channel,channels.linked);assert.ok(payload&&typeof payload==='object'&&'operation'in payload&&typeof payload.operation==='string');const stop=new AbortController();work.set(identity.requestId,stop);
   try{const result=await f.run(payload as Readonly<Record<string,unknown>>,stop.signal);await hooks.reply?.(payload.operation,result);return result;}finally{work.delete(identity.requestId);}
  }),port=client(c);let failed=false,primary:unknown;
  try{await run(f,c,port,hooks);}catch(error){failed=true;primary=error;}f.release();c.stop();try{await c.drain();}catch(cleanup){throw new AggregateError([...(failed?[primary]:[]),cleanup],'Linked client did not join its real adapter calls.',{cause:cleanup});}if(failed)throw primary;
 });
}
void test('Linked client forwards real chooser, bounded native scan/input and SQL publication to actual selected owner',options,async context=>fixture(context,async(f,_c,port)=>{
 const e=await f.write(),grant=await port.chooseFolder();assert.ok(grant);const listed=await port.readGrants();assert.ok(listed.grants.some(value=>value.grantId===grant.grantId));const scan=await port.openScan(grant.grantId);let selected:string|undefined;
 while(true){const page=await port.nextScan(scan);selected=page.entries.find(value=>value.displayName==='Selected native.DNG')?.entryId;if(selected||page.done)break;}assert.ok(selected);const input=await port.openInput(scan,selected);
 try{const bytes=await port.readInput(input.handle,0,input.facts.byteLength);assert.equal(hash(bytes),hash(e.bytes));const candidate=photo({...e.photo,original:{...e.photo.original,storageKey:input.facts.sourceId}}),receipt=await port.publishInput(input.handle,'actual-client-import',candidate);assert.equal(receipt.sourceId,input.facts.sourceId);assert.equal(receipt.sha256,hash(e.bytes));
  const roots=await f.media.catalogOriginals.readPage({catalogId:CATALOG,importId:'actual-client-import'});assert.equal(roots.roots.length,1);const peer=f.peer();try{assert.equal(peer.prepare('SELECT count(*) AS n FROM native_photo_original_bindings').get()?.n,0);}finally{peer.close();}
 }finally{await port.closeInput(input.handle);await port.closeScan(scan);}
}));
void test('Linked client retains genuine cleanup methods after local stop and refuses new borrowed values before reflection',options,async context=>fixture(context,async(f,c,port)=>{
 await f.write();const scan=await port.openScan(f.grant.grantId),page=await port.nextScan(scan),entry=page.entries.find(value=>value.displayName==='Selected native.DNG');assert.ok(entry);const input=await port.openInput(scan,entry.entryId);c.stop();let reflected=0;const poison=new Proxy({},{ownKeys(){reflected++;throw new Error('Borrowed value inspected after local stop.');},get(){reflected++;throw new Error('Borrowed value inspected after local stop.');}});
 await assert.rejects(port.openInput(poison as typeof scan,'f'.repeat(64)));await assert.rejects(port.chooseFolder(poison));assert.equal(reflected,0);await port.closeInput(input.handle);await port.closeScan(scan);assert.equal(f.handles.count,0);
}));
void test('Linked client preserves real revoke COMMIT ACK while false results retain the post-reply stop fence',options,async context=>fixture(context,async(f,c,port,hooks)=>{
 hooks.reply=operation=>{if(operation==='revoke')c.stop();};assert.equal(await port.revoke(f.grant.grantId),true);assert.equal((await f.grants.readPage()).grants.find(value=>value.grantId===f.grant.grantId)?.revoked,true);
}));
void test('Linked client refuses actual false revoke delivered after stop without retracting any native mutation',options,async context=>fixture(context,async(f,c,port,hooks)=>{
 assert.equal(await port.revoke(f.grant.grantId),true);hooks.reply=operation=>{if(operation==='revoke')c.stop();};await assert.rejects(port.revoke(f.grant.grantId));assert.equal((await f.grants.readPage()).grants.find(value=>value.grantId===f.grant.grantId)?.revoked,true);
}));
void test('Linked client joins an actual held native read reply before close, refuses late delivery, and keeps input retirement',options,async context=>fixture(context,async(f,c,port,hooks)=>{
 await f.write();const scan=await port.openScan(f.grant.grantId),page=await port.nextScan(scan),entry=page.entries.find(value=>value.displayName==='Selected native.DNG');assert.ok(entry);const input=await port.openInput(scan,entry.entryId),gate=f.gate();let arrived!:()=>void;const reached=new Promise<void>(resolve=>{arrived=resolve;});
 hooks.reply=async operation=>{if(operation==='input-read'){arrived();await gate.promise;}};const reading=f.track(port.readInput(input.handle,0,input.facts.byteLength));try{await reached;c.stop();let drained=false;const draining=c.drain().then(()=>{drained=true;});await Promise.resolve();assert.equal(drained,false);gate.release();await assert.rejects(reading);await draining;await port.closeInput(input.handle);await port.closeScan(scan);assert.equal(f.handles.count,0);}
 finally{gate.release();await Promise.allSettled([reading]);}
}));
