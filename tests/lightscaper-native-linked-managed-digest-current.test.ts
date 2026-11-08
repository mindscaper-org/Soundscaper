/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {locks} from 'node:worker_threads';
import {importManagedPhotosCurrentV1 as importing} from '../src/lightscaper/import/managed-import-current-v1.ts';
import type {PhotoManagedImportPortsCurrentV1 as Ports} from '../src/lightscaper/import/managed-import-ports-current-v1.ts';
import {verifyPhotoResourcesCurrentV1 as verify} from '../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import {linkedOriginalsFixtureCurrentV1 as fixture,normalizePhotoDocumentCurrentV1 as photo,options,CATALOG,hash} from './helpers/lightscaper-native-linked-originals-integration-fixture-current.ts';
type Fixture=Parameters<Parameters<typeof fixture>[1]>[0];
const exclusive:NonNullable<Ports['exclusive']>=async(catalogId,run,signal)=>{
 signal?.throwIfAborted();const outcome=await locks.request(`lightscaper-photo-catalog:${catalogId}`,{mode:'exclusive',...(signal?{signal}:{})},async lock=>{try{assert.ok(lock);signal?.throwIfAborted();return{okay:true as const,value:await run(signal)};}catch(error){return{okay:false as const,error};}});if(!outcome.okay)throw outcome.error;return outcome.value;
};
function ports(f:Fixture):Readonly<Ports>{
 const method:unknown=Reflect.get(f.media,'findManagedOriginalDigestPageCurrentV1');type Lookup=Ports['media']['custody']['findDigestPage'];
 const lookup:Lookup|undefined=typeof method==='function'?(...args:Parameters<Lookup>)=>Reflect.apply(method,f.media,args) as ReturnType<Lookup>:undefined;
 return Object.freeze<Ports>({catalog:f.catalog,journal:f.settings.settingsRepository,exclusive,verifyResources:(value,signal)=>verify(value,f.resources,signal),
  media:Object.freeze({writeAsset:f.media.writeAsset,custody:f.media.catalogOriginals,...lookup?{findManagedOriginalDigestPageCurrentV1:lookup}:{}})});
}
function managed(value:Parameters<typeof photo>[0],id:string,key:string){const source=photo(value);return photo({...source,id,original:{...source.original,id:`source-${id}`,storageKey:key,retention:'managed'}});}
void test('Current native managed import copies real bytes already published only as linked and reopens a genuine managed binding',options,async context=>fixture(context,async f=>{
 const entry=await f.prepare();await f.publish(entry);const before=f.peer();try{assert.equal(before.prepare('SELECT count(*) AS n FROM native_photo_original_bindings').get()?.n,0);}finally{before.close();}
 const candidate=managed(entry.photo,'managed-copy','z-managed-copy'),result=await f.track(importing(CATALOG,[{photo:candidate,original:new Blob([entry.bytes],{type:candidate.original.mimeType})}],ports(f),{signal:context.signal}));
 assert.equal(result[0]?.status,'imported');assert.equal(result[0]?.reusedOriginal,false);const saved=await f.catalog.loadPhoto(CATALOG,candidate.id);assert.ok(saved);assert.equal(saved.original.retention,'managed');assert.equal(saved.original.storageKey,candidate.original.storageKey);
 const all=await f.media.catalogOriginals.findDigestPage(candidate.original.contentSha256!);assert.ok(all.matches.some(match=>match.assetId===entry.photo.original.storageKey));assert.ok(all.matches.some(match=>match.assetId===candidate.original.storageKey));
 await f.reopen();const reopened=await f.catalog.loadPhoto(CATALOG,candidate.id);assert.ok(reopened);assert.equal(hash(await f.media.readOriginal(reopened.original,0,reopened.original.byteLength)),hash(entry.bytes));
 const peer=f.peer();try{assert.equal(peer.prepare('SELECT count(*) AS n FROM native_photo_original_bindings').get()?.n,1);assert.equal(peer.prepare("SELECT count(*) AS n FROM native_photo_media_identities WHERE kind='managed'").get()?.n,1);assert.equal(peer.prepare("SELECT count(*) AS n FROM native_photo_media_identities WHERE kind='linked'").get()?.n,1);}finally{peer.close();}
}));
void test('Current native managed dedupe skips linked matches but keeps real managed reuse and generic all-kind custody lookup',options,async context=>fixture(context,async f=>{
 const entry=await f.prepare();await f.publish(entry);const first=managed(entry.photo,'managed-first','z-managed-first'),second=managed(entry.photo,'managed-second','z-managed-second'),body=new Blob([entry.bytes],{type:first.original.mimeType});
 assert.equal((await f.track(importing(CATALOG,[{photo:first,original:body}],ports(f),{signal:context.signal})))[0]?.status,'imported');const secondResult=await f.track(importing(CATALOG,[{photo:second,original:body}],ports(f),{signal:context.signal}));assert.equal(secondResult[0]?.status,'imported');assert.equal(secondResult[0]?.reusedOriginal,true);
 const stored=await f.catalog.loadPhoto(CATALOG,second.id);assert.ok(stored);assert.equal(stored.original.retention,'managed');assert.equal(stored.original.storageKey,first.original.storageKey);const method:unknown=Reflect.get(f.media,'findManagedOriginalDigestPageCurrentV1');if(typeof method!=='function')throw new TypeError('Actual native managed digest lookup is absent.');
 const selected:unknown=Reflect.apply(method,f.media,[first.original.contentSha256,null,{signal:context.signal}]);assert.ok(selected instanceof Promise);const page:unknown=await selected;assert.ok(page&&typeof page==='object'&&'matches'in page&&Array.isArray(page.matches));assert.equal(page.matches.length,1);assert.deepEqual(page.matches[0],{assetId:first.original.storageKey,sha256:first.original.contentSha256,size:entry.bytes.byteLength});
 assert.equal((await f.media.catalogOriginals.findDigestPage(first.original.contentSha256!)).matches.length,2);
}));
