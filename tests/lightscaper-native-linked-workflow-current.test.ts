/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {linkedWorkflowFixtureCurrentV1 as fixture,linked,options,hash,remainsPending} from './helpers/lightscaper-native-linked-workflow-integration-fixture-current.ts';
import {photoImportIntentKeyV1} from '../src/lightscaper/import/import-intent-v1.ts';
void test('Complete Current native Session imports actual linked RAW through selected service, native proof, real File and maintained decoder',options,async context=>fixture(context,async f=>{
 const e=await f.file(),{session,runtime}=await f.open(),selected=await f.select(runtime),items=await f.track(runtime.importEntries({scan:selected.scan,entryIds:[selected.entry.entryId]}));
 assert.equal(items.length,1);assert.equal(items[0]?.status,'imported');const id=items[0]?.photoId;assert.ok(id);const stored=await f.catalog.loadPhoto(f.catalogId,id);assert.ok(stored);assert.equal(stored.original.retention,'linked');assert.equal(stored.original.name,'Workflow native.DNG');assert.equal(stored.metadata.fileName,'Workflow native.DNG');assert.equal(stored.metadata.modifiedTime,null);assert.equal(stored.original.contentSha256,hash(e.bytes));assert.equal(stored.original.width,32);assert.equal(stored.original.height,32);
 const db=f.peer();try{assert.equal(db.prepare('SELECT count(*) AS n FROM native_photo_original_bindings').get()?.n,0);assert.equal(db.prepare("SELECT count(*) AS n FROM native_photo_media_identities WHERE kind='linked'").get()?.n,1);}finally{db.close();}
 const roots=await f.media.catalogOriginals.readPage({catalogId:f.catalogId});assert.equal(roots.roots.length,1);assert.equal(roots.roots[0]?.photoId,id);assert.equal(roots.roots[0]?.importId,null);assert.ok((await session.readPage()).rows.some(photo=>photo.id===id));assert.equal(f.workers.active(),0);assert.equal(f.workers.statistics.created,1);await runtime.closeScan(selected.scan);
}));
void test('Linked workflow reuses actual Current authored import settings without changing immutable native source facts',options,async context=>fixture(context,async f=>{
 await f.file();const{runtime}=await f.open(),selected=await f.select(runtime),items=await runtime.importEntries({scan:selected.scan,entryIds:[selected.entry.entryId]},
 {settings:{rename:null,metadata:{caption:'Actual Current linked caption',creator:'Native library author'},keywordIds:[]}});const id=items[0]?.photoId;assert.ok(id);const stored=await f.catalog.loadPhoto(f.catalogId,id);assert.ok(stored);assert.equal(stored.metadata.caption,'Actual Current linked caption');assert.equal(stored.metadata.creator,'Native library author');assert.equal(stored.original.name,'Workflow native.DNG');assert.equal(stored.original.retention,'linked');await runtime.closeScan(selected.scan);
}));
void test('Linked workflow preserves actual Photo ACK under later opaque cancellation and real startup recovers staged custody',options,async context=>fixture(context,async f=>{
 await f.file();const opened=await f.open(),selected=await f.select(opened.runtime),stop=new AbortController(),reason=Symbol('after actual linked Photo ACK');let photoId:string|null=null,failed=false;
 const accepted=f.track(opened.runtime.importEntries({scan:selected.scan,entryIds:[selected.entry.entryId]},{signal:stop.signal,onAcknowledged(item){assert.equal(item.status,'imported');photoId=item.photoId;stop.abort(reason);}}));
 await accepted.then(()=>undefined,error=>{failed=true;assert.equal(error,reason);});assert.equal(failed,true);assert.ok(photoId);assert.ok(await f.catalog.loadPhoto(f.catalogId,photoId));await opened.session.close();const reopened=await f.open();await reopened.session.readPage();
 const roots=await f.media.catalogOriginals.readPage({catalogId:f.catalogId});assert.ok(roots.roots.some(root=>root.photoId===photoId&&root.importId===null));assert.equal((await f.settings.settingsRepository.readEntry(photoImportIntentKeyV1(f.catalogId))).present,false);
}));
void test('Complete Session close joins held actual linked File write and retains the native role until local consumer retirement',options,async context=>fixture(context,async f=>{
 await f.file();const{session,runtime}=await f.open(),selected=await f.select(runtime),gate=f.storage.gate();f.storage.hooks.write=()=>gate.promise;const importing=f.track(runtime.importEntries({scan:selected.scan,entryIds:[selected.entry.entryId]}));let closing:Promise<void>|undefined;
 try{await f.storage.reached('write-start',importing);closing=session.close();assert.equal(await remainsPending(closing),true);assert.equal(f.liveChildren(),1);gate.release();await Promise.allSettled([importing]);await closing;assert.equal(f.liveChildren(),0);assert.equal(f.storage.counts().stages,0);}
 finally{gate.release();await Promise.allSettled([importing,...(closing?[closing]:[])]);}
}));
void test("Linked workflow's genuine Current capability refuses after Session close before inspecting a borrowed selection",options,async context=>fixture(context,async f=>{
 const{session,runtime}=await f.open();assert.equal(linked({}),null);assert.equal(linked(new Proxy({}, {get(){throw new Error('Forged Session inspected.');}})),null);await session.close();let reflected=0;
 const poison=new Proxy({}, {ownKeys(){reflected++;throw new Error('Borrowed selection reflected.');},get(){reflected++;throw new Error('Borrowed selection reflected.');}});await assert.rejects(runtime.importEntries(poison));assert.equal(reflected,0);
}));
