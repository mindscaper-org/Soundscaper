/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import { join } from 'node:path';
import { LightscaperNativePhotoMediaCurrentV1 as Media, captureLightscaperNativePhotoMediaRawInputsCurrentV1 as capture } from '../../desktop/lightscaper-native-photo-media-current-v1.ts';
import { LightscaperNativePhotoSessionRawInputsCurrentV1 as Registry } from '../../desktop/lightscaper-native-photo-session-raw-inputs-current-v1.ts';
import { LightscaperNativePhotoSessionHandlesCurrentV1 as Handles } from '../../desktop/lightscaper-native-photo-session-handles-current-v1.ts';
export interface RawInputDebtWorkerCurrentV1 { readonly appDataPath: string }
const {appDataPath}=workerData as RawInputDebtWorkerCurrentV1, media=await Media.open({appDataPath}), handles=new Handles(), stop=new AbortController();let notified=0;
const registry=Registry.create({media,handles,scope:{signal:stop.signal,assertCurrent(){stop.signal.throwIfAborted();}},unretired(){notified++;}});
const bytes=new TextEncoder().encode('Actual completed RAW input cleanup witness.'),sha=createHash('sha256').update(bytes).digest('hex');
const facet=capture(media),upload=await facet.begin({expectedBytes:bytes.byteLength,expectedSha256:sha});await upload.write(bytes);const source=await facet.consume(await upload.finish());
const witness=await open(join(appDataPath,'file-handle-witness'),'wx'),prototype=Object.getPrototypeOf(witness) as object,descriptor=Object.getOwnPropertyDescriptor(prototype,'read');await witness.close();
assert.ok(descriptor&&typeof descriptor.value==='function');const native=descriptor.value as FileHandle['read'];let armed=true,actualClose=false;
Object.defineProperty(prototype,'read',{...descriptor,value:function(this:FileHandle,...args:unknown[]){const actual=Reflect.apply(native,this,args) as ReturnType<FileHandle['read']>;
 if(armed){armed=false;const close=this.close;Object.defineProperty(this,'close',{configurable:true,value:async function(this:FileHandle){await Reflect.apply(close,this,[]);actualClose=true;throw new Error('Genuine native input close receipt refused.');}});}return actual;}});
let originalQuarantined=false,attemptRefused=false,registryCloseRefused=false,mediaCloseRefused=false;
try{
 const chunk=await source.read(0,bytes.byteLength);chunk.fill(0);try{await source.close();}catch{originalQuarantined=true;}
 try{await registry.execute({operation:'begin',expectedBytes:bytes.byteLength,expectedSha256:sha},stop.signal);}catch{attemptRefused=true;}
 try{await registry.close();}catch{registryCloseRefused=true;}try{await media.close();}catch{mediaCloseRefused=true;}
}finally{Object.defineProperty(prototype,'read',descriptor);bytes.fill(0);}
parentPort?.postMessage({actualClose,originalQuarantined,attemptRefused,handleDebt:handles.count,notified,registryCloseRefused,mediaCloseRefused});parentPort?.close();
