/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkedSessionFixtureCurrentV1 as fixture,options,CATALOG,photo,hash } from './helpers/lightscaper-native-linked-session-integration-fixture-current.ts';
import { photoImportIntentKeyV1,normalizePhotoImportIntentV1 } from '../src/lightscaper/import/import-intent-v1.ts';
void test('Linked Session real staged publication binds independently prepared full Photo then actual Catalog and custody promotion',options,async context=>fixture(context,async f=>{
 const e=await f.write(),selected=await f.open('Selected native.DNG'),candidate=photo({...e.photo,original:{...e.photo.original,storageKey:selected.facts.sourceId}}),importId='linked-session-import';
 await f.settings.settingsRepository.put(photoImportIntentKeyV1(CATALOG),normalizePhotoImportIntentV1({schemaVersion:1,kind:'photo-import',catalogId:CATALOG,importId},CATALOG));
 const receipt=await f.run({operation:'publish-input',handle:selected.handle,importId,photo:candidate});assert.deepEqual(receipt,{sourceId:selected.facts.sourceId,sha256:hash(e.bytes),size:e.bytes.byteLength});
 const staged=await f.media.catalogOriginals.readPage({catalogId:CATALOG,importId});assert.equal(staged.roots.length,1);assert.equal(staged.roots[0]?.sourceId,candidate.original.id);
 const root=await f.catalog.loadCatalog(CATALOG);assert.ok(root);await f.catalog.publishPhotos(CATALOG,root.revision,[candidate]);await f.media.catalogOriginals.promote(CATALOG,importId,[candidate.id]);
 await f.closeInput(selected);const request={catalogId:CATALOG,photoId:candidate.id,original:candidate.original};const ticket=await f.tickets.transport.open(request);try{assert.ok(ticket&&typeof ticket==='object');}finally{assert.ok(ticket&&typeof ticket==='object'&&'id'in ticket);await f.tickets.transport.close({id:String(ticket.id)});}
}));
void test('Linked Session wrong input SHA/full Photo catalog refuses before any linked asset or root publication',options,async context=>fixture(context,async f=>{
 const e=await f.write(),selected=await f.open('Selected native.DNG'),wrong=photo({...e.photo,original:{...e.photo.original,storageKey:selected.facts.sourceId,contentSha256:'f'.repeat(64)}});
 await assert.rejects(f.run({operation:'publish-input',handle:selected.handle,importId:'refused',photo:wrong}));assert.equal(await f.media.getAssetMetadata(selected.facts.sourceId),null);const p=await f.media.catalogOriginals.readPage({catalogId:CATALOG,importId:'refused'});assert.equal(p.roots.length,0);await f.closeInput(selected);
}));
void test('Linked Session actual SQLite metadata/root COMMIT ACK survives cancellation without creating a managed body',options,async context=>fixture(context,async f=>{
 const e=await f.write(),selected=await f.open('Selected native.DNG'),candidate=photo({...e.photo,original:{...e.photo.original,storageKey:selected.facts.sourceId}}),stop=new AbortController(),peer=f.peer();
 const proto=Object.getPrototypeOf(peer) as object,original=Object.getOwnPropertyDescriptor(proto,'exec');assert.ok(original&&typeof original.value==='function');const exec=original.value as (sql:string)=>void;let acknowledged=false;
 Object.defineProperty(proto,'exec',{...original,value:function(this:typeof peer,sql:string){const value=Reflect.apply(exec,this,[sql]) as void;if(sql==='COMMIT'&&!this.isTransaction){try{const exists=this.prepare('SELECT 1 AS n FROM native_photo_media_assets WHERE source_id=?').get(selected.facts.sourceId);if(exists){acknowledged=true;stop.abort(Symbol('actual linked metadata ACK'));}}catch{/* Other private SQLite owner. */}}return value;}});
 try{const receipt=await f.run({operation:'publish-input',handle:selected.handle,importId:'late-ack',photo:candidate},stop.signal);assert.equal(acknowledged,true);assert.deepEqual(receipt,{sourceId:selected.facts.sourceId,sha256:hash(e.bytes),size:e.bytes.byteLength});assert.equal(peer.prepare('SELECT count(*) AS n FROM native_photo_original_bindings').get()?.n,0);}
 finally{Object.defineProperty(proto,'exec',original);peer.close();await f.closeInput(selected);}
}));
void test('Linked Session SQL root refusal rolls back its real asset identity and retains input cleanup ownership',options,async context=>fixture(context,async f=>{
 const e=await f.write(),selected=await f.open('Selected native.DNG'),candidate=photo({...e.photo,original:{...e.photo.original,storageKey:selected.facts.sourceId}}),peer=f.peer();
 try{peer.exec("CREATE TEMP TABLE unused(n)");peer.exec("CREATE TRIGGER linked_session_refuse_root BEFORE INSERT ON native_photo_media_roots BEGIN SELECT RAISE(ABORT,'actual linked root refusal'); END");await assert.rejects(f.run({operation:'publish-input',handle:selected.handle,importId:'refused-sql',photo:candidate}));assert.equal(peer.prepare('SELECT count(*) AS n FROM native_photo_media_identities').get()?.n,0);assert.equal(peer.prepare('SELECT count(*) AS n FROM native_photo_media_assets').get()?.n,0);await f.closeInput(selected);}
 finally{peer.exec('DROP TRIGGER IF EXISTS linked_session_refuse_root');peer.close();}
}));
