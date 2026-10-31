/* SPDX-License-Identifier: AGPL-3.0-only */
import {DesktopPhotoSessionClientCallsCurrentV1 as Calls,desktopPhotoSignalCurrentV1 as signal,desktopPhotoVoidCurrentV1 as empty,desktopPhotoBooleanCurrentV1 as boolean} from './desktop-photo-library-session-client-calls-current-v1.ts';
import {readClosedDomainRecord as record,readClosedDomainField as field} from '../common/foundation/closed-domain-value.ts';
import {id,integer} from './catalog/value-validation.ts';
import {readDesktopPhotoLibrarySessionHandleCurrentV1 as handle} from './desktop-photo-library-session-protocol-current-v1.ts';
import {readDesktopPhotoLinkedGrantCurrentV1 as grant,readDesktopPhotoLinkedGrantsCurrentV1 as grants,readDesktopPhotoLinkedPageCurrentV1 as page} from './desktop-photo-linked-replies-current-v1.ts';
import {readDesktopPhotoLinkedInputCurrentV1 as input,desktopPhotoLinkedIdCurrentV1 as token} from './desktop-photo-linked-contract-current-v1.ts';
import {copyDesktopPhotoBytesCurrentV1 as copy} from './desktop-photo-library-session-transfer-client-current-v1.ts';
import type {DesktopPhotoLinkedLibraryPortCurrentV1 as Port,DesktopPhotoLinkedInputCurrentV1 as Handle} from './desktop-photo-linked-port-current-v1.ts';
import type {PhotoLibraryRawImportSourceCurrentV1 as RawImport} from './controller/photo-library-raw-import-current-v1.ts';
import {readDesktopPhotoLinkedInspectionCurrentV1 as inspection,readDesktopPhotoLinkedOriginalPageCurrentV1 as originals} from './desktop-photo-linked-management-contract-current-v1.ts';
export function createDesktopPhotoLinkedLibraryPortCurrentV1(c:Calls,rawImport?:((input:Handle)=>Readonly<RawImport>)):Readonly<Port>{
 const send=<Value>(capture:()=>unknown,read:(value:unknown)=>Value|Promise<Value>,options:unknown=undefined,mutation:boolean|((value:Value)=>boolean)=false):Promise<Value>=>c.own(()=>c.send('linked',capture,read,signal(options),false,mutation));
 return Object.freeze<Port>({
  inspectOriginal:(binding,options)=>send(()=>({operation:'inspect-original',binding}),inspection,options),
  readOriginalsPage:(cursor=null,options)=>send(()=>({operation:'inspect-page',cursor}),value=>originals(value,c.descriptor.catalogId),options),
  chooseFolder:options=>send(()=>({operation:'choose-folder'}),value=>value===null?null:grant(value),options,value=>value!==null),
  readGrants:(afterGrantId=null,options)=>send(()=>({operation:'grants',afterGrantId}),grants,options),
  openScan:(grantId,entryId,options)=>send(()=>({operation:'scan-open',grantId,...entryId===undefined?{}:{entryId}}),value=>handle(field(record(value,'native scan acquisition',['handle']),'handle','native scan acquisition'),'linked-scan'),options,true),
  nextScan:(selected,options)=>send(()=>({operation:'scan-next',handle:selected}),page,options),
  closeScan:selected=>c.send('linked',()=>({operation:'scan-close',handle:selected}),empty,undefined,true,true),
  openInput:(scan,entryId,options)=>send(()=>({operation:'input-open',scan,entryId}),input,options,true),
  readInput:(selected,offset,length,options)=>c.own(()=>{let owned:Uint8Array<ArrayBuffer>|undefined;return send(()=>({operation:'input-read',handle:selected,offset,length}),value=>{const bytes=copy(value);owned=bytes;if(bytes.byteLength!==length){bytes.fill(0);throw new Error('Linked read reply has wrong interval.');}return bytes;},options).catch((error:unknown)=>{owned?.fill(0);throw error;});}),
  closeInput:selected=>c.send('linked',()=>({operation:'input-close',handle:selected}),empty,undefined,true,true),
  publishInput:(selected,importId,photo,options)=>send(()=>({operation:'publish-input',handle:selected,importId,photo}),value=>{const r=record(value,'linked publication reply',['sourceId','sha256','size']);return Object.freeze({sourceId:id(field(r,'sourceId','linked publication reply'),'linked source ID'),sha256:token(field(r,'sha256','linked publication reply')),size:integer(field(r,'size','linked publication reply'),1,Number.MAX_SAFE_INTEGER,'linked body bytes')});},options,true),
  relinkInput:(selected,binding,expectedRevision,options)=>send(()=>({operation:'relink-input',handle:selected,binding,expectedRevision}),value=>{const r=record(value,'linked relink reply',['assetId','sha256','size','revision']);return Object.freeze({assetId:id(field(r,'assetId','linked relink reply'),'linked asset ID'),sha256:token(field(r,'sha256','linked relink reply')),size:integer(field(r,'size','linked relink reply'),1,Number.MAX_SAFE_INTEGER,'linked bytes'),revision:integer(field(r,'revision','linked relink reply'),1,Number.MAX_SAFE_INTEGER,'linked revision')});},options,true),
  revoke:(grantId,options)=>send(()=>({operation:'revoke',grantId}),boolean,options,value=>value===true),
  ...rawImport?{rawImport:(value:Handle)=>{c.assert();return rawImport(handle(value,'linked-input'));}}:{},
 });
}
