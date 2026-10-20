/* SPDX-License-Identifier: AGPL-3.0-only */
import {readClosedDomainRecord as record,readClosedDomainField as field} from '../common/editor/closed-domain-value.ts';
import {normalizePhotoDocumentCurrentV1} from './catalog/photo-document-current-v1.ts';
import {id,integer,name} from './catalog/value-validation.ts';
import {normalizeCatalogOriginalRepairBindingV1} from '../common/editor/storage/media-catalog-original-repair-contract.ts';
import {IMAGE_IMPORT_LIMITS} from '../common/editor/image-import-admission.ts';
import {readDesktopPhotoLibrarySessionHandleCurrentV1 as handle,type DesktopPhotoLibrarySessionHandleCurrentV1 as Handle} from './desktop-photo-library-session-protocol-current-v1.ts';
export type DesktopPhotoLinkedInputHandleCurrentV1=Readonly<Handle<'linked-input'>>;
export interface DesktopPhotoLinkedInputFactsCurrentV1{readonly sourceId:string;readonly displayName:string;readonly byteLength:number;readonly contentSha256:string;readonly modifiedTime:null}
export interface DesktopPhotoLinkedInputReceiptCurrentV1{readonly handle:DesktopPhotoLinkedInputHandleCurrentV1;readonly facts:Readonly<DesktopPhotoLinkedInputFactsCurrentV1>}
export function desktopPhotoLinkedIdCurrentV1(value:unknown):string{if(typeof value!=='string'||!/^[a-f0-9]{64}$/u.test(value))throw new TypeError('Linked capability ID must be lower64hex.');return value;}
export function readDesktopPhotoLinkedInputCurrentV1(value:unknown):Readonly<DesktopPhotoLinkedInputReceiptCurrentV1>{
 const r=record(value,'linked input receipt',['handle','facts']),f=record(field(r,'facts','linked input receipt'),'linked input facts',['sourceId','displayName','byteLength','contentSha256','modifiedTime']);
 if(field(f,'modifiedTime','linked input facts')!==null)throw new TypeError('Native linked source has no timestamp claim.');
 return Object.freeze({handle:handle(field(r,'handle','linked input receipt'),'linked-input'),facts:Object.freeze({sourceId:id(field(f,'sourceId','linked input facts'),'linked source ID'),displayName:name(field(f,'displayName','linked input facts'),'linked filename'),byteLength:integer(field(f,'byteLength','linked input facts'),1,IMAGE_IMPORT_LIMITS.maximumFileInputBytes,'linked input bytes'),contentSha256:desktopPhotoLinkedIdCurrentV1(field(f,'contentSha256','linked input facts')),modifiedTime:null})});
}
export function readDesktopPhotoLinkedPacketCurrentV1(value:unknown,catalogId:string):Readonly<Record<string,unknown>>{
 const descriptor=value!==null&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,'operation'):undefined;
 if(!descriptor||!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='string')throw new TypeError('Linked operation must be an own inert field.');
 const op=descriptor.value;const fields:Record<string,readonly string[]>={'available':[],'choose-folder':[],'grants':['afterGrantId'],'scan-open':['grantId','entryId'],'scan-next':['handle'],'scan-close':['handle'],'input-open':['scan','entryId'],'input-read':['handle','offset','length'],'input-close':['handle'],'publish-input':['handle','importId','photo'],'relink-input':['handle','binding','expectedRevision'],'revoke':['grantId'],'inspect-page':['cursor'],'inspect-original':['binding']};
 const allowed=fields[op];if(!allowed)throw new TypeError('Unknown fixed linked operation.');const r=record(value,'linked operation',['operation',...allowed],op==='scan-open'?['operation','grantId']:['operation',...allowed]),get=(key:string)=>field(r,key,'linked operation'),out:Record<string,unknown>={operation:op};
 if(op==='inspect-page'){const cursor=get('cursor');if(cursor!==null&&(typeof cursor!=='string'||new TextEncoder().encode(cursor).byteLength>4096))throw new RangeError('Linked cursor exceeds4KiB.');out.cursor=cursor;}
 if(op==='inspect-original'){const binding=normalizeCatalogOriginalRepairBindingV1(get('binding'));if(binding.catalogId!==catalogId)throw new Error('Linked inspection belongs to another selected catalog.');out.binding=binding;}
 if(op==='grants')out.afterGrantId=get('afterGrantId')===null?null:desktopPhotoLinkedIdCurrentV1(get('afterGrantId'));
 if(op==='scan-open'||op==='revoke')out.grantId=desktopPhotoLinkedIdCurrentV1(get('grantId'));
 if(op==='scan-open'&&Object.hasOwn(r,'entryId'))out.entryId=desktopPhotoLinkedIdCurrentV1(get('entryId'));
 if(op==='scan-next'||op==='scan-close')out.handle=handle(get('handle'),'linked-scan');
 if(op==='input-open'){out.scan=handle(get('scan'),'linked-scan');out.entryId=desktopPhotoLinkedIdCurrentV1(get('entryId'));}
 if(['input-read','input-close','publish-input','relink-input'].includes(op))out.handle=handle(get('handle'),'linked-input');
 if(op==='input-read'){out.offset=integer(get('offset'),0,Number.MAX_SAFE_INTEGER,'linked read offset');out.length=integer(get('length'),1,1048576,'linked read length');}
 if(op==='publish-input'){const photo=normalizePhotoDocumentCurrentV1(get('photo'));if(photo.catalogId!==catalogId||photo.revision!==0||photo.original.retention!=='linked')throw new Error('Linked publication requires an initial linked Photo in its selected catalog.');out.photo=photo;out.importId=id(get('importId'),'linked import ID');}
 if(op==='relink-input'){const binding=normalizeCatalogOriginalRepairBindingV1(get('binding'));if(binding.catalogId!==catalogId)throw new Error('Linked repair binding belongs to another catalog.');out.binding=binding;out.expectedRevision=integer(get('expectedRevision'),0,Number.MAX_SAFE_INTEGER-1,'linked revision');}
 return Object.freeze(out);
}
