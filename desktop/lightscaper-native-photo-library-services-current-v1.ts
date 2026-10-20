/* SPDX-License-Identifier: AGPL-3.0-only */
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {readClosedDomainRecord as record,readClosedDomainField as field} from '../src/common/editor/closed-domain-value.ts';
import type {NativePath} from './lightscaper-native-photo-granted-filesystem-current-v1.ts';
import type {LightscaperNativePhotoPreparedChildCurrentV1 as Prepared} from './lightscaper-native-photo-prepared-child-current-v1.ts';
import type {LightscaperNativePhotoRawPreparedCurrentV1 as RawPrepared} from './lightscaper-native-photo-raw-originals-current-v1.ts';
export interface LightscaperNativePhotoLibraryServicesCurrentV1{
 readonly startGrantedFilesystem?:()=>ChildProcessWithoutNullStreams;
 readonly prepareGrantedFilesystem?:(options:Readonly<{signal:AbortSignal}>)=>Promise<Readonly<Prepared>>;
 readonly chooseLinkedRoot?:(signal?:AbortSignal)=>Promise<Readonly<{path:NativePath;displayName:string}>|null>;
 readonly prepareRaw?:(options:Readonly<{signal:AbortSignal}>)=>Promise<Readonly<RawPrepared>|undefined>;
}
/** Only trusted Main composition supplies these capabilities. No renderer
 * DTO/path/function is converted into an authenticated native launcher. */
export function captureLightscaperNativePhotoLibraryServicesCurrentV1(value:unknown):Readonly<LightscaperNativePhotoLibraryServicesCurrentV1>{
 if(value===undefined)return Object.freeze({});const r=record(value,'native library trusted services',['startGrantedFilesystem','prepareGrantedFilesystem','chooseLinkedRoot','prepareRaw'],[]);
 const read=(key:string)=>Object.hasOwn(r,key)?field(r,key,'native library trusted services'):undefined;
 const start=read('startGrantedFilesystem'),prepare=read('prepareGrantedFilesystem'),choose=read('chooseLinkedRoot'),raw=read('prepareRaw');
 for(const item of[start,prepare,choose,raw])if(item!==undefined&&typeof item!=='function')throw new TypeError('Native library service must be callable.');
 if(start!==undefined&&prepare!==undefined)throw new TypeError('Native linked services require exactly one filesystem starter mode.');
 if((start!==undefined||prepare!==undefined)!==(choose!==undefined))throw new TypeError('Native linked services require authenticated filesystem preparation and trusted chooser together.');
 return Object.freeze({...typeof start==='function'?{startGrantedFilesystem:()=>Reflect.apply(start,value,[]) as ChildProcessWithoutNullStreams}:{},
  ...typeof prepare==='function'?{prepareGrantedFilesystem:(options:Readonly<{signal:AbortSignal}>)=>Reflect.apply(prepare,value,[options]) as ReturnType<NonNullable<LightscaperNativePhotoLibraryServicesCurrentV1['prepareGrantedFilesystem']>>}:{},
  ...typeof choose==='function'?{chooseLinkedRoot:(signal?:AbortSignal)=>Reflect.apply(choose,value,[signal]) as ReturnType<NonNullable<LightscaperNativePhotoLibraryServicesCurrentV1['chooseLinkedRoot']>>}:{},
  ...typeof raw==='function'?{prepareRaw:(options:Readonly<{signal:AbortSignal}>)=>Reflect.apply(raw,value,[options]) as ReturnType<NonNullable<LightscaperNativePhotoLibraryServicesCurrentV1['prepareRaw']>>}:{}});
}
