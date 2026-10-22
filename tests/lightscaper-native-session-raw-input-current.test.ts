/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { LightscaperNativePhotoSessionRawInputsCurrentV1 as Registry } from '../desktop/lightscaper-native-photo-session-raw-inputs-current-v1.ts';
import { LightscaperNativePhotoSessionHandlesCurrentV1 as Handles } from '../desktop/lightscaper-native-photo-session-handles-current-v1.ts';
import { captureLightscaperNativePhotoMediaRawInputsCurrentV1 as capture, bindLightscaperNativePhotoMediaRawInputFacadeCurrentV1 as bind } from '../desktop/lightscaper-native-photo-media-current-v1.ts';
import { nativeRawOriginalsFixtureCurrentV1 as fixture, nativeRawOriginalsHashCurrentV1 as hash } from './helpers/lightscaper-native-raw-originals-fixture-current.ts';
const CHECK=AbortSignal.prototype.throwIfAborted;
async function pending(work:Promise<unknown>):Promise<boolean>{let done=false;void work.then(()=>{done=true;},()=>{done=true;});await setImmediate();return !done;}
type Actual=Parameters<Parameters<typeof fixture>[1]>[0];
function owner(f:Actual,handles=new Handles()){
 const registry=Registry.create({media:f.components.media,handles,scope:{signal:f.signal,assertCurrent(){Reflect.apply(CHECK,f.signal,[]);f.scopes.describe(f.selected.scope);}},unretired(){f.state.alerts++;}});
 return {registry,handles};
}
async function upload(f:Actual,registry:ReturnType<typeof Registry.create>){
 const opened=await registry.execute({operation:'begin',expectedBytes:f.bytes.byteLength,expectedSha256:hash(f.bytes)},f.signal);
 assert.ok(opened&&typeof opened==='object');const handle=Reflect.get(opened,'handle') as Readonly<{kind:'raw-input';id:string}>;
 await registry.execute({operation:'write',handle,sequence:0,offset:0,bytes:f.bytes},f.signal);
 const finished=await registry.execute({operation:'finish',handle},f.signal);assert.ok(finished&&typeof finished==='object');assert.equal(Reflect.get(finished,'byteLength'),f.bytes.byteLength);return handle;
}

void test('Main RAW input Media facet requires genuine owner and maps only a genuine selected facade', {timeout:15000},async context=>{
 await fixture(context,async f=>{let reflected=0;const proxy=new Proxy({}, {get(){reflected++;throw new Error('Borrowed.');},getPrototypeOf(){reflected++;throw new Error('Borrowed.');}});
  assert.throws(()=>capture(proxy));assert.throws(()=>capture(Object.create(Object.getPrototypeOf(f.components.media)) as unknown));assert.equal(reflected,0);
  const facade=Object.freeze({});assert.equal(bind(facade,f.components.media),facade);assert.equal(capture(facade),capture(f.components.media));
  assert.throws(()=>bind(Object.freeze({}),proxy));assert.equal(reflected,0);
 });
});

void test('Main RAW input finishes genuine private file with same handle and retains slot through one-use borrow until explicit close', {timeout:15000},async context=>{
 await fixture(context,async f=>{const {registry,handles}=owner(f);try{const handle=await upload(f,registry);assert.equal(handles.count,1);
  await registry.withInput(handle.id,async view=>{assert.equal(view.byteLength,f.bytes.byteLength);assert.equal(view.contentSha256,hash(f.bytes));const actual=await view.read(0,view.byteLength);try{assert.equal(hash(actual),hash(f.bytes));}finally{actual.fill(0);}});
  assert.equal(handles.count,1);await assert.rejects(registry.withInput(handle.id,()=>undefined));await registry.execute({operation:'close',handle},f.signal);assert.equal(handles.count,0);
 }finally{await registry.close();}});
});

void test('Main RAW input write captures actual borrowed bytes synchronously before queued native file IO', {timeout:15000},async context=>{
 await fixture(context,async f=>{const {registry}=owner(f);try{const opened=await registry.execute({operation:'begin',expectedBytes:f.bytes.byteLength,expectedSha256:hash(f.bytes)},f.signal);assert.ok(opened&&typeof opened==='object');const handle=Reflect.get(opened,'handle') as Readonly<{kind:'raw-input';id:string}>;
  const input=f.bytes.slice(),work=registry.execute({operation:'write',handle,sequence:0,offset:0,bytes:input},f.signal);input.fill(0);await work;await registry.execute({operation:'finish',handle},f.signal);
  await registry.withInput(handle.id,async view=>{const actual=await view.read(0,view.byteLength);try{assert.equal(hash(actual),hash(f.bytes));}finally{actual.fill(0);}});
 }finally{await registry.close();}});
});

void test('Main RAW input handle close joins actual entered borrower before physical file retirement', {timeout:15000},async context=>{
 await fixture(context,async f=>{const {registry,handles}=owner(f),entered=f.gate(),release=f.gate();let work:Promise<unknown>|undefined,close:Promise<unknown>|undefined;
  try{const handle=await upload(f,registry);work=f.track(registry.withInput(handle.id,async view=>{const actual=await view.read(0,view.byteLength);actual.fill(0);entered.release();await release.promise;}));await f.reached(entered.promise,work);
   close=registry.execute({operation:'close',handle},f.signal);assert.equal(await pending(close),true);assert.equal(handles.count,1);release.release();await work;await close;assert.equal(handles.count,0);
  }finally{release.release();await Promise.allSettled([...(work?[work]:[]),...(close?[close]:[])]);await registry.close();}
 });
});

void test('Main RAW input staging refusal and foreign handle never manufacture completed-file authority', {timeout:15000},async context=>{
 await fixture(context,async f=>{const {registry,handles}=owner(f);const foreign=handles.reserve('download');foreign.publish({close:async()=>undefined});
  try{const opened=await registry.execute({operation:'begin',expectedBytes:f.bytes.byteLength,expectedSha256:hash(f.bytes)},f.signal);assert.ok(opened&&typeof opened==='object');const handle=Reflect.get(opened,'handle') as Readonly<{kind:'raw-input';id:string}>;
   await assert.rejects(registry.withInput(handle.id,()=>undefined));await assert.rejects(registry.execute({operation:'finish',handle},f.signal));await registry.execute({operation:'close',handle},f.signal);
   await assert.rejects(registry.execute({operation:'write',handle:foreign.handle,sequence:0,offset:0,bytes:Uint8Array.of(1)},f.signal));assert.equal(handles.count,1);
  }finally{await registry.close();await handles.close(foreign.handle,'download');}
 });
});

void test('Main RAW input shares actual16-handle capacity and retires only its own handles', {timeout:15000},async context=>{
 await fixture(context,async f=>{const handles=new Handles(),foreign=Array.from({length:15},()=>{const slot=handles.reserve('download');slot.publish({close:async()=>undefined});return slot;});const {registry}=owner(f,handles);
  try{await registry.execute({operation:'begin',expectedBytes:f.bytes.byteLength,expectedSha256:hash(f.bytes)},f.signal);assert.equal(handles.count,16);
   await assert.rejects(registry.execute({operation:'begin',expectedBytes:f.bytes.byteLength,expectedSha256:hash(f.bytes)},f.signal));await registry.close();assert.equal(handles.count,15);
  }finally{await registry.close();await Promise.all(foreign.map(slot=>handles.close(slot.handle,'download')));}
 });
});
