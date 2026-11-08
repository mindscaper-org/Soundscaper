/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import { LightscaperNativePhotoSessionServiceCurrentV1 as Main } from '../desktop/lightscaper-native-photo-session-service-current-v1.ts';
import { createDesktopPhotoLibrarySessionServiceCurrentV1 as client } from '../src/lightscaper/desktop-photo-library-session-client-current-v1.ts';
import { DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 as channels } from '../src/lightscaper/desktop-photo-library-session-protocol-current-v1.ts';
import { nativeRawOriginalsFixtureCurrentV1 as fixture, nativeRawOriginalsHashCurrentV1 as hash } from './helpers/lightscaper-native-raw-originals-fixture-current.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import type { DesktopPhotoLibrarySessionStorageCurrentV1 as Storage } from '../src/lightscaper/desktop-photo-library-session-storage-current-v1.ts';
type F = Parameters<Parameters<typeof fixture>[1]>[0];
async function connected(context: TestContext, run: (f: F, storage: Readonly<Storage>) => Promise<void>, native = true): Promise<void> {
 await fixture(context, async f => {
  await f.native.close(); await f.components.close(); await f.scopes.close();
  const scopes = await Scopes.open({appDataPath:f.directory,...(native?{services:{prepareRaw:f.prepare}}:{})}), main = new Main(scopes), owner = Object.freeze({});
  const controls = new Map<string, (kind:'stop'|'retire')=>Promise<void>>();
  let storage: Readonly<Storage> | undefined, failed=false, primary:unknown;
  const service = client({ installRetirement(id, handler) {controls.set(id,handler);return ()=>{controls.delete(id);};},
   async invoke(channel, payload) {
    if(channel===channels.open){assert.ok(payload&&typeof payload==='object');const id=Reflect.get(payload,'openId') as string;const handler=controls.get(id);assert.ok(handler);return main.open(owner,payload,{close:()=>handler('retire')});}
    return main.dispatch(channel,owner,payload);
   }});
  try { storage=await service.open({name:'Installed RAW wire'},{close:async()=>undefined});await run(f,storage); }
  catch(error){failed=true;primary=error;}
  const results=await Promise.allSettled([storage?.close(),main.closeAll()]),errors=results.flatMap(r=>r.status==='rejected'?[r.reason as unknown]:[]);
  try{await scopes.close();}catch(error){errors.push(error);}
  if(errors.length)throw new AggregateError([...(failed?[primary]:[]),...errors],'Actual native RAW wire did not retire.',{cause:errors[0]});if(failed)throw primary;
 });
}
void test('Installed RAW Session transports full native output and prepublication input through genuine Main owners', {timeout:15000,concurrency:false}, async context=>connected(context,async(f,s)=>{
 assert.ok(s.components.raw);let retained:PixelFrameV1['pixels']|undefined;
 const result=await s.components.raw.withFrame({catalogId:s.catalogId,photoId:f.photo.id,original:f.photo.original,expectedRevision:null,profile:'canonical'},view=>{retained=view.frame.pixels;assert.equal(hash(new Uint8Array(view.frame.pixels.buffer)),view.contentSha256);return view.frame.descriptor.width;});
 assert.equal(result.outcome,'native');assert.ok(retained?.every(n=>n===0));assert.equal(f.activeChildren(),0);
 assert.ok(s.components.rawImport);const imported=await s.components.rawImport.withFrame({body:new Blob([f.bytes]),contentSha256:hash(f.bytes),profile:'canonical'},view=>{assert.deepEqual(view.input,{byteLength:f.bytes.byteLength,contentSha256:hash(f.bytes)});return view.frame.descriptor.width;});assert.equal(imported.outcome,'native');assert.equal(f.activeChildren(),0);
}));
void test('Installed RAW Session retirement holds actual delivered renderer plane until consumer release and joins all native work', {timeout:15000,concurrency:false}, async context=>connected(context,async(f,s)=>{
 assert.ok(s.components.raw);const entered=f.gate(),release=f.gate();let plane:PixelFrameV1['pixels']|undefined;const photo=f.photo;
 const work=f.track(s.components.raw.withFrame({catalogId:s.catalogId,photoId:photo.id,original:photo.original,expectedRevision:null,profile:'canonical'},async view=>{plane=view.frame.pixels;entered.release();await release.promise;}));
 try{await f.reached(entered.promise,work);let settled=false;const closing=s.close();void closing.then(()=>{settled=true;},()=>{settled=true;});await setImmediate();assert.equal(settled,false);assert.ok(plane?.some(n=>n!==0));release.release();await Promise.allSettled([work]);await closing;assert.ok(plane?.every(n=>n===0));assert.equal(f.activeChildren(),0);}
 finally{release.release();await Promise.allSettled([work]);}
}));
void test('Installed RAW Session keeps classified Web fallback available when native payloads are absent', {timeout:15000,concurrency:false}, async context=>connected(context,async(f,s)=>{
 assert.ok(s.components.raw);const photo=f.photo;assert.deepEqual(await s.components.raw.withFrame({catalogId:s.catalogId,photoId:photo.id,original:photo.original,expectedRevision:null,profile:'canonical'},()=>assert.fail('No native decoder is installed.')),{outcome:'web-fallback',reason:'native-unavailable'});
 assert.ok(s.components.rawImport);assert.deepEqual(await s.components.rawImport.withFrame({body:new Blob([f.bytes]),contentSha256:hash(f.bytes),profile:'canonical'},()=>assert.fail('No native import decoder is installed.')),{outcome:'web-fallback',reason:'native-unavailable'});assert.equal(f.activeChildren(),0);
},false));
