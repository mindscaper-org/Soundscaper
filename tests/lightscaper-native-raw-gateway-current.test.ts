/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { nativeRawGatewayFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-raw-gateway-fixture-current.ts';
import { nativeRawOriginalsHashCurrentV1 as hash } from './helpers/lightscaper-native-raw-originals-fixture-current.ts';
import { captureLightscaperNativePhotoRawPartsCurrentV1 as capture } from '../desktop/lightscaper-native-photo-raw-parts-current-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
const bytes=(frame:Readonly<PixelFrameV1>)=>new Uint8Array(frame.pixels.buffer,frame.pixels.byteOffset,frame.pixels.byteLength);
async function pending(work:Promise<unknown>):Promise<boolean>{let done=false;void work.then(()=>{done=true;},()=>{done=true;});await setImmediate();return !done;}

void test('Actual native RAW Parts private capture ignores replaced public transport and refuses forged authority', {timeout:15000},async context=>{
 await fixture(context,async f=>{const issued=capture(f.parts);let reflected=0;assert.throws(()=>capture(new Proxy({}, {get(){reflected++;throw new Error('Borrowed.');}})));assert.equal(reflected,0);
  const descriptor=Object.getOwnPropertyDescriptor(f.parts,'transport');assert.ok(descriptor);Object.defineProperty(f.parts,'transport',{configurable:true,get(){reflected++;throw new Error('Replaced public transport.');}});
  try{assert.equal(capture(f.parts),issued);const result=await f.track(f.source.raw.withFrame(f.request(),view=>{assert.equal(view.decoder.engine,'lightscaper-libraw-native');return view.frame.descriptor.width;}));
   assert.equal(result.outcome,'native');if(result.outcome==='native')assert.equal(result.value,f.photo.original.width);assert.equal(reflected,0);assert.equal(f.activeChildren(),0);
  }finally{Object.defineProperty(f.parts,'transport',descriptor);}
 });
});

void test('Actual selected RAW gateway uploads once then authenticates distinct native input ticket without stored Photo fiction', {timeout:15000},async context=>{
 await fixture(context,async f=>{const opened=await f.gateway.executeInput({operation:'begin',expectedBytes:f.bytes.byteLength,expectedSha256:hash(f.bytes)},f.signal);assert.ok(opened&&typeof opened==='object');const handle=Reflect.get(opened,'handle') as Readonly<{kind:'raw-input';id:string}>;
  await f.gateway.executeInput({operation:'write',handle,sequence:0,offset:0,bytes:f.bytes},f.signal);await f.gateway.executeInput({operation:'finish',handle},f.signal);
  const source=f.source.forInput(handle.id);let held:Readonly<PixelFrameV1>|undefined;
  const result=await f.track(source.withFrame({body:new Blob([f.bytes]),contentSha256:hash(f.bytes),profile:'canonical'},view=>{held=view.frame;assert.deepEqual(view.input,{byteLength:f.bytes.byteLength,contentSha256:hash(f.bytes)});assert.equal(view.decoder.engine,'lightscaper-libraw-native');assert.equal(view.frame.descriptor.width,f.photo.original.width);assert.equal(hash(bytes(view.frame)),view.contentSha256);return 'input';},{signal:f.signal}));
  assert.equal(result.outcome,'native');assert.ok(held);assert.ok(held.pixels.every(sample=>sample===0));assert.equal(f.activeChildren(),0);assert.equal(f.handles.count,1);
  await f.gateway.executeInput({operation:'close',handle},f.signal);assert.equal(f.handles.count,0);
 });
});

void test('Actual RAW source consumer retirement precedes gateway input/parts/selected lease retirement', {timeout:15000},async context=>{
 await fixture(context,async f=>{const entered=f.gate(),release=f.gate();let held:Readonly<PixelFrameV1>|undefined,before='';const work=f.track(f.source.raw.withFrame(f.request(),async view=>{held=view.frame;before=hash(bytes(view.frame));entered.release();await release.promise;}));let close:Promise<void>|undefined;
  try{await f.reached(entered.promise,work);close=f.source.close();assert.equal(await pending(close),true);assert.ok(held);assert.equal(hash(bytes(held)),before);release.release();await Promise.allSettled([work]);await close;await f.gateway.close();assert.equal(f.activeChildren(),0);assert.ok(held.pixels.every(sample=>sample===0));}
  finally{release.release();await Promise.allSettled([work,...(close?[close]:[])]);}
 });
});

void test('Actual RAW gateway owner close retires its unfinished native upload handle without closing component-owned stored Parts early', {timeout:15000},async context=>{
 await fixture(context,async f=>{await f.gateway.executeInput({operation:'begin',expectedBytes:f.bytes.byteLength,expectedSha256:hash(f.bytes)},f.signal);assert.equal(f.handles.count,1);await f.gateway.close();assert.equal(f.handles.count,0);
  const opened=await capture(f.parts).transport.open({kind:'frame',request:f.request()},{signal:f.signal});assert.equal(opened.outcome,'ready');if(opened.outcome==='ready')await capture(f.parts).transport.close({id:opened.ticket.id});assert.equal(f.activeChildren(),0);
 });
});
