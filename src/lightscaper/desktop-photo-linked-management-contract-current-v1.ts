/* SPDX-License-Identifier: AGPL-3.0-only */
import {readClosedDomainRecord as record,readClosedDomainField as field,readClosedDomainArray as array} from '../common/foundation/closed-domain-value.ts';
import {normalizeCatalogOriginalRepairBindingV1,type CatalogOriginalRepairBindingV1 as Binding} from '../common/editor/storage/media-catalog-original-repair-contract.ts';
import {id,integer,name} from './catalog/value-validation.ts';
import {desktopPhotoLinkedIdCurrentV1 as token} from './desktop-photo-linked-contract-current-v1.ts';
export interface DesktopPhotoLinkedInspectionCurrentV1{readonly locatorRevision:number;readonly grantId:string;readonly status:'present'|'unavailable';readonly reason:'grant-missing'|'grant-revoked'|'root-missing'|'file-missing'|null}
export interface DesktopPhotoLinkedOriginalRowCurrentV1 extends DesktopPhotoLinkedInspectionCurrentV1{readonly photoId:string;readonly photoRevision:number;readonly fileName:string;readonly binding:Readonly<Binding>}
export interface DesktopPhotoLinkedOriginalPageCurrentV1{readonly catalogId:string;readonly catalogRevision:number;readonly rows:readonly Readonly<DesktopPhotoLinkedOriginalRowCurrentV1>[];readonly cursor:string|null}
export function readDesktopPhotoLinkedInspectionCurrentV1(value:unknown):Readonly<DesktopPhotoLinkedInspectionCurrentV1>{
 const r=record(value,'linked Original inspection',['locatorRevision','grantId','status','reason']),status=field(r,'status','linked Original inspection'),reason=field(r,'reason','linked Original inspection');
 if(status!=='present'&&status!=='unavailable')throw new TypeError('Linked inspection status is invalid.');
 if(status==='present'?reason!==null:!(typeof reason==='string'&&['grant-missing','grant-revoked','root-missing','file-missing'].includes(reason)))throw new TypeError('Linked inspection classification is invalid.');
 return Object.freeze({locatorRevision:integer(field(r,'locatorRevision','linked Original inspection'),0,Number.MAX_SAFE_INTEGER,'linked locator revision'),grantId:token(field(r,'grantId','linked Original inspection')),status,reason:reason as DesktopPhotoLinkedInspectionCurrentV1['reason']});
}
export function readDesktopPhotoLinkedOriginalPageCurrentV1(value:unknown,catalogId:string):Readonly<DesktopPhotoLinkedOriginalPageCurrentV1>{
 const r=record(value,'linked Original page',['catalogId','catalogRevision','rows','cursor']);if(field(r,'catalogId','linked Original page')!==catalogId)throw new Error('Linked Original page belongs to another selected catalog.');
 const seen=new Set<string>(),rows=array(field(r,'rows','linked Original page'),'linked Original rows',0,64).map(value=>{
  const row=record(value,'linked Original row',['photoId','photoRevision','fileName','binding','locatorRevision','grantId','status','reason']),get=(key:string)=>field(row,key,'linked Original row'),photoId=id(get('photoId'),'linked Photo ID'),binding=normalizeCatalogOriginalRepairBindingV1(get('binding'));
  if(seen.has(photoId)||binding.photoId!==photoId||binding.catalogId!==catalogId)throw new Error('Linked Original page repeats or misbinds a Photo.');seen.add(photoId);
  return Object.freeze({...readDesktopPhotoLinkedInspectionCurrentV1({locatorRevision:get('locatorRevision'),grantId:get('grantId'),status:get('status'),reason:get('reason')}),photoId,photoRevision:integer(get('photoRevision'),0,Number.MAX_SAFE_INTEGER,'linked Photo revision'),fileName:name(get('fileName'),'linked file name'),binding});
 });const cursor=field(r,'cursor','linked Original page');if(cursor!==null&&(typeof cursor!=='string'||new TextEncoder().encode(cursor).byteLength>4096))throw new RangeError('Linked continuation exceeds its bound.');
 return Object.freeze({catalogId,catalogRevision:integer(field(r,'catalogRevision','linked Original page'),0,Number.MAX_SAFE_INTEGER,'linked catalog revision'),rows:Object.freeze(rows),cursor});
}
