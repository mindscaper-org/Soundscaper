/* SPDX-License-Identifier: AGPL-3.0-only */
import {photoNativePreparedRetirementIsUnprovedCurrentV1 as preparedUnproved,type LightscaperNativePhotoPreparedChildCurrentV1 as Prepared} from './lightscaper-native-photo-prepared-child-current-v1.ts';
import {LightscaperNativePhotoGrantedFilesystemCurrentV1 as Filesystem,lightscaperNativePhotoGrantedFilesystemRetirementIsUnprovedCurrentV1 as fsUnproved} from './lightscaper-native-photo-granted-filesystem-current-v1.ts';
import {LightscaperNativePhotoLinkedGrantsCurrentV1 as Grants} from './lightscaper-native-photo-linked-grants-current-v1.ts';
import {LightscaperNativePhotoLinkedOriginalsCurrentV1 as Linked} from './lightscaper-native-photo-linked-originals-current-v1.ts';
import {LightscaperNativePhotoLinkedSessionCurrentV1 as Session} from './lightscaper-native-photo-linked-session-current-v1.ts';
import {deriveLightscaperNativePhotoOriginalPathsCurrentV1} from './lightscaper-native-original-index-current-v1.ts';
import {linkedGrantCleanupIsUnprovedCurrentV1 as grantUnproved,createLinkedGrantCleanupFailureCurrentV1 as cleanup} from './lightscaper-native-photo-linked-grants-failures-current-v1.ts';
import type {LightscaperNativePhotoLibraryServicesCurrentV1 as Services} from './lightscaper-native-photo-library-services-current-v1.ts';
import type {LightscaperNativePhotoSessionHandlesCurrentV1 as Handles} from './lightscaper-native-photo-session-handles-current-v1.ts';
import type {LightscaperNativePhotoSessionCallsCurrentV1 as Calls} from './lightscaper-native-photo-session-calls-current-v1.ts';
import {captureLightscaperNativeCatalogReadCurrentV1 as captureCatalog,type LightscaperNativeCatalogReadCurrentV1 as CatalogRead} from './lightscaper-native-catalog-store-current-v1.ts';
type Scope=Readonly<{signal:AbortSignal;assertCurrent():void}>;
export interface LightscaperNativePhotoLinkedComponentsCurrentV1{readonly grants:Grants;readonly originals:Linked;bindCatalog(value:unknown):void;close():Promise<void>}
type Private=Readonly<{createSession(catalogId:string,handles:Handles,scope:Scope):Session}>;
const CHECK=AbortSignal.prototype.throwIfAborted;
const PARTS=new WeakMap<object,Private>(),FACADES=new WeakMap<object,Private>(),QUARANTINE=new Set<object>();
/** Runs only after actual same-generation Media opened its LSCP4 namespace. */
export async function openLightscaperNativePhotoLinkedComponentsCurrentV1(appDataPath:string,services:Readonly<Services>,scope:Scope,unretired:()=>void):Promise<Readonly<LightscaperNativePhotoLinkedComponentsCurrentV1>|undefined>{
 const start=services.startGrantedFilesystem,prepare=services.prepareGrantedFilesystem,choose=services.chooseLinkedRoot;if((!start&&!prepare)||!choose)return undefined;
 if(start&&prepare)throw new TypeError('Native linked Components require one filesystem starter mode.');
 const namespace=deriveLightscaperNativePhotoOriginalPathsCurrentV1(appDataPath).databasePath;let filesystem:Filesystem|undefined,grants:Grants|undefined,originals:Linked|undefined,prepared:Readonly<Prepared>|undefined,catalogRead:CatalogRead|undefined,retirePrepared:(()=>Promise<void>)|undefined,closing:Promise<void>|undefined;
 const close=():Promise<void>=>{if(closing)return closing;closing=Promise.resolve().then(async()=>{const errors:unknown[]=[];for(const owner of[originals,grants,filesystem])try{await owner?.close();}catch(error){errors.push(error);}try{await retirePrepared?.();}catch(error){errors.push(error);}if(errors.length){try{unretired();}catch(error){errors.push(error);}QUARANTINE.add({originals,grants,filesystem,prepared,retirePrepared,close,errors});throw cleanup(errors,'Selected linked owners did not retire.');}});return closing;};
 const check=():void=>{Reflect.apply(CHECK,scope.signal,[]);scope.assertCurrent();};
 try{check();let launch=start;
  if(prepare){prepared=await prepare(Object.freeze({signal:scope.signal}));const actual=prepared;
   try{const retire=actual.close;if(typeof retire!=='function')throw new TypeError('Prepared filesystem has no retirement owner.');retirePrepared=()=>Reflect.apply(retire,actual,[]) as Promise<void>;const begin=actual.start;if(typeof begin!=='function')throw new TypeError('Prepared filesystem has no one-use native starter.');launch=()=>Reflect.apply(begin,actual,[]) as ReturnType<NonNullable<Services['startGrantedFilesystem']>>;}
   catch(primary){if(!retirePrepared){QUARANTINE.add({prepared,close,primary});try{unretired();}catch(error){throw cleanup([primary,error],'Prepared filesystem owner capture and quarantine failed.');}}throw primary;}check();}
  if(!launch)throw new TypeError('Native filesystem launch is unavailable.');filesystem=await Filesystem.open({start:launch,mediaDatabasePath:namespace,signal:scope.signal});check();grants=await Grants.open({appDataPath,filesystem,chooser:{chooseRoot:choose},scope,unretired});check();originals=await Linked.open({appDataPath,grants,scope,unretired});check();
  const actualGrants=grants,actualOriginals=originals,actualFilesystem=filesystem,parts=Object.freeze({grants,originals,bindCatalog(value:unknown):void{check();if(catalogRead)throw new Error('Linked Catalog is already bound.');catalogRead=captureCatalog(value,namespace);},close});
  PARTS.set(parts,Object.freeze<Private>({createSession:(catalogId,handles,localScope)=>Session.create({appDataPath,catalogId,grants:actualGrants,originals:actualOriginals,filesystem:actualFilesystem,handles,scope:localScope,unretired,...(catalogRead?{catalog:catalogRead}:{})})}));return parts;
 }catch(caught){let primary=caught;if(fsUnproved(primary)||grantUnproved(primary)||preparedUnproved(primary))try{unretired();}catch(error){primary=cleanup([primary,error],'Linked opening quarantine notification failed.');}try{await close();}catch(error){throw cleanup([primary,error],'Selected linked opening and retirement failed.');}throw primary;}
}
/** Opaque Main facet, absent from renderer Storage. Genuine private capture
 * prevents an arbitrary facade or DTO from lending selected filesystem owners. */
export function createLightscaperNativePhotoSessionLinkedFacadeCurrentV1(value:unknown,calls:Calls):Readonly<object>{
 const actual=value!==null&&typeof value==='object'?PARTS.get(value):undefined;if(!actual)throw new TypeError('Genuine selected linked components are required.');const facade=Object.freeze({});
 FACADES.set(facade,Object.freeze<Private>({createSession:(catalogId,handles,scope)=>calls.sync(()=>actual.createSession(catalogId,handles,scope))}));return facade;
}
export function captureLightscaperNativePhotoSessionLinkedFacadeCurrentV1(value:unknown):Private{
 const actual=value!==null&&typeof value==='object'?FACADES.get(value):undefined;if(!actual)throw new TypeError('Genuine selected linked facade required.');return actual;
}
