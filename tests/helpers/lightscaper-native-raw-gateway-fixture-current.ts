/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { LightscaperNativePhotoOriginalsCurrentV1 as Originals } from '../../desktop/lightscaper-native-photo-originals-current-v1.ts';
import { LightscaperNativePhotoRawPartsCurrentV1 as Parts } from '../../desktop/lightscaper-native-photo-raw-parts-current-v1.ts';
import { LightscaperNativePhotoSessionRawCurrentV1 as Gateway } from '../../desktop/lightscaper-native-photo-session-raw-current-v1.ts';
import { LightscaperNativePhotoSessionHandlesCurrentV1 as Handles } from '../../desktop/lightscaper-native-photo-session-handles-current-v1.ts';
import { bindLightscaperNativePhotoMediaRawInputFacadeCurrentV1 as bind } from '../../desktop/lightscaper-native-photo-media-current-v1.ts';
import { DesktopPhotoRawSourceCurrentV1 as Source } from '../../src/lightscaper/desktop-photo-raw-source-current-v1.ts';
import { nativeRawOriginalsFixtureCurrentV1 as fixture } from './lightscaper-native-raw-originals-fixture-current.ts';
type Actual=Parameters<Parameters<typeof fixture>[1]>[0];
export async function nativeRawGatewayFixtureCurrentV1<Value>(context:TestContext,run:(f:Actual & Readonly<{parts:ReturnType<typeof Parts.create>;gateway:ReturnType<typeof Gateway.create>;handles:Handles;source:Source}>)=>Promise<Value>):Promise<Value>{
 return fixture(context,async f=>{
  await f.native.close();await f.components.close();let parts:ReturnType<typeof Parts.create>|undefined,lease:Awaited<ReturnType<typeof f.scopes.openSessionLease>>|undefined,gateway:ReturnType<typeof Gateway.create>|undefined,source:Source|undefined,media:Parameters<typeof Originals.create>[0]['media']|undefined;
  let failed=false,primary:unknown,result!:Value;
  const descriptor=Object.getOwnPropertyDescriptor(Originals,'create');assert.ok(descriptor);const actual=Originals.create;
  const observe:typeof Originals.create=options=>{const reader=Reflect.apply(actual,Originals,[options]) as ReturnType<typeof Originals.create>;media=options.media;
   parts=Parts.create({catalog:options.catalog,originals:reader,prepare:f.prepare,scope:options.scope,unretired(){f.state.alerts++;}});return reader;};
  Object.defineProperty(Originals,'create',{...descriptor,value:observe});
  try{
   try{lease=await f.scopes.openSessionLease(f.selected.scope,{close:async()=>undefined},{signal:f.signal});}finally{Object.defineProperty(Originals,'create',descriptor);}
   assert.ok(parts);assert.ok(media);bind(lease.components.media,media);
   const selected=Object.freeze({...lease,components:Object.freeze({...lease.components,rawParts:parts})}),handles=new Handles();
   gateway=Gateway.create({lease:selected,handles});source=new Source(gateway.transport,{signal:f.signal});result=await run({...f,parts,gateway,handles,source});
  }catch(error){failed=true;primary=error;}
  {
   Object.defineProperty(Originals,'create',descriptor);const errors:unknown[]=[];
   for(const owner of [source,gateway,parts,lease])try{await owner?.close();}catch(error){errors.push(error);}
   if(errors.length)throw new AggregateError([...(failed?[primary]:[]),...errors],'Actual RAW gateway/source/parts/selected lease did not retire.',{cause:errors[0]});
  }
  if(failed)throw primary;return result;
 });
}
