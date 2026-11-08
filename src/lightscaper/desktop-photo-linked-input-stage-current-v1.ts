/* SPDX-License-Identifier: AGPL-3.0-only */
import {readClosedDomainRecord as record,readClosedDomainField as field} from '../common/foundation/closed-domain-value.ts';
import {assertPhotoStackQuerySignalV1} from './catalog/photo-stack-query-signal-v1.ts';
import {readDesktopPhotoLibrarySessionHandleCurrentV1 as handle} from './desktop-photo-library-session-protocol-current-v1.ts';
import {readDesktopPhotoLinkedInputCurrentV1 as receipt,type DesktopPhotoLinkedInputHandleCurrentV1 as Handle,type DesktopPhotoLinkedInputFactsCurrentV1 as Facts} from './desktop-photo-linked-contract-current-v1.ts';
import type {DesktopPhotoOriginalStorageCurrentV1 as Storage,DesktopPhotoOriginalSourceOptionsCurrentV1 as Options} from './desktop-photo-original-contract-current-v1.ts';
import {DesktopPhotoLinkedInputBodyCurrentV1 as Body} from './desktop-photo-linked-input-body-current-v1.ts';
export interface DesktopPhotoLinkedInputTransportCurrentV1{read(handle:Handle,offset:number,length:number):Promise<unknown>;close(handle:Handle):Promise<void>}
export interface DesktopPhotoLinkedInputLeaseCurrentV1{readonly body:File;readonly facts:Readonly<Facts>;close():Promise<void>}
const Controller=AbortController,ABORT=AbortController.prototype.abort,CHECK=AbortSignal.prototype.throwIfAborted,ADD=EventTarget.prototype.addEventListener,REMOVE=EventTarget.prototype.removeEventListener;
const SIGNAL=Object.getOwnPropertyDescriptor(AbortController.prototype,'signal')!.get!,ABORTED=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')!.get!,REASON=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'reason')!.get!;
interface Entry{readonly controller:AbortController;readonly signal:AbortSignal;readonly body:Body;readonly done:Promise<void>;doneResolve():void;detach():void;release?:()=>Promise<void>;published:boolean;bytes:number;retiring?:Promise<unknown[]>}
/** Caller leases span actual preparation/SQL and local retirement. Source close
 * fences unpublished acquisitions, then waits actual published File retirement. */
export class DesktopPhotoLinkedInputSourceCurrentV1{
 readonly #transport:Readonly<DesktopPhotoLinkedInputTransportCurrentV1>;readonly #storage:Storage;readonly #createId:()=>string;readonly #entries=new Set<Entry>();readonly #quarantined=new Set<Entry>();readonly #failures:unknown[]=[];
 #active=0;#bytes=0;#closed=false;#closing:Promise<void>|undefined;
 constructor(value:Readonly<DesktopPhotoLinkedInputTransportCurrentV1>,options:Options={}){
  const r=record(value,'linked input transport',['read','close']),read=field(r,'read','linked input transport'),close=field(r,'close','linked input transport');if(typeof read!=='function'||typeof close!=='function')throw new TypeError('Complete bounded linked input transport is required.');
  this.#transport=Object.freeze<DesktopPhotoLinkedInputTransportCurrentV1>({read:(h,o,l)=>Reflect.apply(read,value,[h,o,l]) as Promise<unknown>,close:h=>Reflect.apply(close,value,[h]) as Promise<void>});
  const config=record(options,'linked input storage options',['storage','createId'],[]),storage=(Object.hasOwn(config,'storage')?field(config,'storage','linked input storage options'):globalThis.navigator?.storage) as Storage|undefined;
  if(!storage||typeof storage.getDirectory!=='function')throw new TypeError('Linked input requires genuine OPFS storage.');const directory=storage.getDirectory;this.#storage=Object.freeze({getDirectory:()=>Reflect.apply(directory,storage,[]) as ReturnType<Storage['getDirectory']>});
  const create=Object.hasOwn(config,'createId')?field(config,'createId','linked input storage options'):undefined;if(create!==undefined&&typeof create!=='function')throw new TypeError('Linked input stage ID factory must be callable.');this.#createId=create?()=>Reflect.apply(create,options,[]) as string:()=>crypto.randomUUID();
 }
 readonly acquire=(value:unknown,options:Readonly<{signal?:AbortSignal}>={}):Promise<Readonly<DesktopPhotoLinkedInputLeaseCurrentV1>>=>{
  try{this.#check();if(this.#active>=4)throw new RangeError('Linked input acquisition capacity is busy.');}catch(error){return Promise.reject(error);}
  let resolve!:(lease:Readonly<DesktopPhotoLinkedInputLeaseCurrentV1>)=>void,reject!:(reason:unknown)=>void;const pending=new Promise<Readonly<DesktopPhotoLinkedInputLeaseCurrentV1>>((yes,no)=>{resolve=yes;reject=no;});let doneResolve!:()=>void;
  const controller=new Controller(),entry:Entry={controller,signal:Reflect.apply(SIGNAL,controller,[]) as AbortSignal,body:new Body(),done:new Promise<void>(yes=>{doneResolve=yes;}),doneResolve,detach:()=>undefined,published:false,bytes:0};this.#entries.add(entry);this.#active++;
  let captured:ReturnType<typeof receipt>;
  try{this.#link(entry,options);check(entry.signal);const input=record(value,'linked input stage receipt',['handle','facts']),selected=handle(field(input,'handle','linked input stage receipt'),'linked-input');entry.release=this.#release(selected);if(aborted(entry.signal))void entry.release().catch(()=>undefined);
   captured=receipt(value);check(entry.signal);if(captured.facts.byteLength>134217728-this.#bytes)throw new RangeError('Linked input stage retained-byte capacity is full.');entry.bytes=captured.facts.byteLength;this.#bytes+=entry.bytes;
  }catch(error){let primary=error;try{check(entry.signal);}catch(reason){primary=reason;}void this.#retire(entry,primary).then(errors=>{this.#active--;reject(combine([primary,...errors],'Linked input admission and retirement failed.'));});return pending;}
  void this.#materialize(entry,captured).then(lease=>{this.#active--;resolve(lease);},(error:unknown)=>{this.#active--;reject(error);});return pending;
 };
 async #materialize(entry:Entry,captured:ReturnType<typeof receipt>):Promise<Readonly<DesktopPhotoLinkedInputLeaseCurrentV1>>{
  try{check(entry.signal);this.#check();const body=await entry.body.materialize(this.#storage,this.#createId,captured.facts,(offset,length)=>this.#transport.read(captured.handle,offset,length),entry.signal);check(entry.signal);this.#check();entry.published=true;let closing:Promise<void>|undefined;
   return Object.freeze({body,facts:captured.facts,close:():Promise<void>=>{closing??=this.#retire(entry).then(errors=>{if(errors.length)throw combine(errors,'Linked input File retirement failed.');});return closing;}});
  }catch(error){let primary=error;try{check(entry.signal);}catch(reason){primary=reason;}const errors=await this.#retire(entry,primary);throw combine([primary,...errors],'Linked input stage and retirement failed.');}
 }
 #release(value:Handle):()=>Promise<void>{let closing:Promise<void>|undefined;return()=>{if(closing)return closing;let resolve!:()=>void,reject!:(reason:unknown)=>void;closing=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});try{void this.#transport.close(value).then(resolve,reject);}catch(error){reject(error);}void closing.catch(()=>undefined);return closing;};}
 #retire(entry:Entry,reason?:unknown):Promise<unknown[]>{entry.retiring??=Promise.resolve().then(async()=>{const errors:unknown[]=[],release=entry.release?.();const failed=(error:unknown):void=>{remember(errors,error);this.#quarantined.add(entry);this.#latch(entry,error);};if(release)void release.catch(failed);
  try{await entry.body.retire(reason);}catch(error){failed(error);}try{await release;}catch(error){failed(error);}try{entry.detach();}catch(error){failed(error);}if(!errors.length){this.#bytes-=entry.bytes;entry.bytes=0;}this.#entries.delete(entry);entry.doneResolve();return errors;
 });return entry.retiring;}
 #latch(entry:Entry,error:unknown):void{remember(this.#failures,error);for(const sibling of this.#entries)if(sibling!==entry&&!sibling.published&&!aborted(sibling.signal)){try{Reflect.apply(ABORT,sibling.controller,[new DOMException('Linked stage retirement is unproved.','AbortError')]);}catch(cleanup){remember(this.#failures,cleanup);}}}
 #link(entry:Entry,value:unknown):void{
  const descriptor=value!==null&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,'signal'):undefined,external:unknown=descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;if(external!==undefined)assertPhotoStackQuerySignalV1(external);const caller=external as AbortSignal|undefined;
  const cancelled=():void=>{if(!entry.published&&entry.release)void entry.release().catch(()=>undefined);},forward=():void=>{if(caller&&!aborted(entry.signal))Reflect.apply(ABORT,entry.controller,[Reflect.apply(REASON,caller,[])]);};
  entry.detach=()=>{Reflect.apply(REMOVE,entry.signal,['abort',cancelled]);if(caller)Reflect.apply(REMOVE,caller,['abort',forward]);};Reflect.apply(ADD,entry.signal,['abort',cancelled,{once:true}]);if(caller){Reflect.apply(ADD,caller,['abort',forward,{once:true}]);if(aborted(caller))forward();}
  const r=record(value,'linked input acquire options',['signal'],[]);if((Object.hasOwn(r,'signal')?field(r,'signal','linked input acquire options'):undefined)!==caller)throw new TypeError('Linked input signal changed during admission.');
 }
 #check():void{if(this.#closed||this.#failures.length)throw new Error('Linked input source is closed or quarantined.');}
 close():Promise<void>{if(this.#closing)return this.#closing;this.#closed=true;let resolve!:()=>void,reject!:(reason:unknown)=>void;this.#closing=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});const entries=[...this.#entries];for(const entry of entries)try{Reflect.apply(ABORT,entry.controller,[new DOMException('Linked input source closed.','AbortError')]);}catch(error){remember(this.#failures,error);}
  void Promise.all(entries.map(entry=>entry.done)).then(()=>{if(this.#failures.length)throw combine(this.#failures,'Linked input source retirement is unproved.');}).then(resolve,reject);return this.#closing;
 }
}
function check(signal:AbortSignal):void{Reflect.apply(CHECK,signal,[]);}
function aborted(signal:AbortSignal):boolean{return Reflect.apply(ABORTED,signal,[])===true;}
function remember(values:unknown[],value:unknown):void{if(!values.some(held=>Object.is(held,value)))values.push(value);}
function combine(values:readonly unknown[],message:string):unknown{const errors:unknown[]=[];for(const value of values)remember(errors,value);return errors.length===1?errors[0]:new AggregateError(errors,message,{cause:errors[0]});}
