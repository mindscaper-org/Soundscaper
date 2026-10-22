/* SPDX-License-Identifier: AGPL-3.0-only */
import {readClosedDomainRecord as record,readClosedDomainField as field,readClosedDomainArray as array} from '../common/editor/closed-domain-value.ts';
import {integer} from './catalog/value-validation.ts';
import {desktopPhotoLinkedIdCurrentV1 as token} from './desktop-photo-linked-contract-current-v1.ts';
import type {DesktopPhotoLinkedGrantCurrentV1 as Grant,DesktopPhotoLinkedPageCurrentV1 as Page,DesktopPhotoLinkedEntryCurrentV1 as Entry} from './desktop-photo-linked-port-current-v1.ts';
export function readDesktopPhotoLinkedGrantCurrentV1(value:unknown):Readonly<Grant>{const r=record(value,'linked grant reply',['grantId','displayName','revision','revoked']);return Object.freeze({grantId:token(field(r,'grantId','linked grant reply')),displayName:display(field(r,'displayName','linked grant reply')),revision:integer(field(r,'revision','linked grant reply'),0,Number.MAX_SAFE_INTEGER,'linked grant revision'),revoked:boolean(field(r,'revoked','linked grant reply'))});}
export function readDesktopPhotoLinkedGrantsCurrentV1(value:unknown):Readonly<{grants:readonly Readonly<Grant>[];afterGrantId:string|null}>{
 const r=record(value,'linked grants reply',['grants','afterGrantId']),grants=Object.freeze(array(field(r,'grants','linked grants reply'),'linked grant page',0,64).map(readDesktopPhotoLinkedGrantCurrentV1)),after=field(r,'afterGrantId','linked grants reply'),afterGrantId=after===null?null:token(after);
 if(afterGrantId!==null&&(grants.length!==64||grants.at(-1)?.grantId!==afterGrantId))throw new Error('Linked grant cursor differs from its actual bounded page.');return Object.freeze({grants,afterGrantId});
}
export function readDesktopPhotoLinkedPageCurrentV1(value:unknown):Readonly<Page>{
 const r=record(value,'linked scan reply',['entries','done']),entries=Object.freeze(array(field(r,'entries','linked scan reply'),'linked scan page',0,64).map(value=>{const e=record(value,'linked scan entry',['entryId','displayName','kind','byteLength']),kind=field(e,'kind','linked scan entry'),size=field(e,'byteLength','linked scan entry');if(kind!=='file'&&kind!=='directory'&&kind!=='link'&&kind!=='other'&&kind!=='unknown')throw new TypeError('Invalid native entry kind.');return Object.freeze<Entry>({entryId:token(field(e,'entryId','linked scan entry')),displayName:display(field(e,'displayName','linked scan entry')),kind,byteLength:size===null?null:integer(size,0,Number.MAX_SAFE_INTEGER,'linked entry bytes')});}));return Object.freeze({entries,done:boolean(field(r,'done','linked scan reply'))});
}
function display(value:unknown):string{if(typeof value!=='string'||value.length>4096)throw new TypeError('Linked display name exceeds its bounded scalar grammar.');return value;}
function boolean(value:unknown):boolean{if(typeof value!=='boolean')throw new TypeError('Linked reply requires a boolean.');return value;}
