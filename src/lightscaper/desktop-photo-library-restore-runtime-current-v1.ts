/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { PhotoLibraryRestoreRuntimeV1,PhotoLibraryRestoreReceiptV1 as Receipt } from '../common/editor/photo-library-restore-port-v1.ts';
import { readClosedDomainRecord as record,readClosedDomainField as field } from '../common/foundation/closed-domain-value.ts';
import { DESKTOP_SCAPE_READ_HARD_LIMIT_BYTES } from '../common/editor/desktop-read-profile.ts';
import { name } from './catalog/value-validation.ts';
import { assertMediaRestoreSignalV1 as signal,checkMediaRestoreSignalV1 as check,forwardMediaRestoreSignalV1 as forward } from './storage/photo-media-restore-signal-v1.ts';
import { DESKTOP_PHOTO_LIBRARY_RESTORE_CHANNELS_CURRENT_V1 as CHANNELS,DESKTOP_PHOTO_LIBRARY_RESTORE_CHUNK_BYTES_CURRENT_V1 as CHUNK,
	readDesktopPhotoLibraryRestoreIdCurrentV1 as readId,readDesktopPhotoLibraryRestoreBeginReceiptCurrentV1 as beginReceipt,
	readDesktopPhotoLibraryRestoreWriteReceiptCurrentV1 as writeReceipt,readDesktopPhotoLibraryRestoreReceiptCurrentV1 as receipt } from './desktop-photo-library-restore-contract-current-v1.ts';
export interface DesktopPhotoLibraryRestoreRuntimeOptionsCurrentV1{readonly name:string;readonly transport:Readonly<{invoke(channel:string,payload:unknown):Promise<unknown>}>}
interface Deferred<T>{readonly promise:Promise<T>;resolve(value:T):void;reject(error:unknown):void}
function deferred<T>():Deferred<T>{let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const SIZE=Object.getOwnPropertyDescriptor(Blob.prototype,'size')!.get!,SLICE=Blob.prototype.slice,READ=Blob.prototype.arrayBuffer;
const ADD=EventTarget.prototype.addEventListener,REMOVE=EventTarget.prototype.removeEventListener;
interface Demand{readonly work:Promise<Readonly<Receipt>>;stop?:ReturnType<typeof forward>;id?:string;aborting?:Promise<void>}

/** Matched native runtime. The installed invoke closure owns authenticated
	* Main calls. Only actual Blob ranges cross the wire; restore remains the
	* real native fresh-generation/Ready/anchor publication operation. */
export function createDesktopPhotoLibraryRestoreRuntimeCurrentV1(value:DesktopPhotoLibraryRestoreRuntimeOptionsCurrentV1):PhotoLibraryRestoreRuntimeV1{
	const row=record(value,'native restore runtime',['name','transport']),catalogName=name(field(row,'name','native restore runtime'),'catalog name');
	const transport=field(row,'transport','native restore runtime');if(!transport||typeof transport!=='object')throw new TypeError('Native restore requires its installed transport.');
	const invoke=Reflect.get(transport,'invoke') as unknown;if(typeof invoke!=='function')throw new TypeError('Native restore requires its installed invoke.');
	const call=(channel:string,packet:unknown):Promise<unknown>=>{try{return Promise.resolve(Reflect.apply(invoke,transport,[channel,packet]) as Promise<unknown>);}catch(error){return Promise.reject(error);}};
	let active:Demand|undefined,closed=false,closing:Promise<void>|undefined;const cleanup:unknown[]=[];
	const notice=(error:unknown):void=>{if(!cleanup.some(value=>Object.is(value,error)))cleanup.push(error);};
	const abort=(demand:Demand):Promise<void>=>{
	 if(demand.aborting)return demand.aborting;if(demand.id===undefined)return Promise.resolve();
	 const result=deferred<void>();demand.aborting=result.promise;
	 void call(CHANNELS.abort,{id:demand.id}).then(value=>{if(value!==undefined)throw new TypeError('Native restore abort must have an empty ACK.');}).then(result.resolve,error=>{notice(error);result.reject(error);});
	 void result.promise.catch(()=>undefined);return result.promise;
	};
	return Object.freeze<PhotoLibraryRestoreRuntimeV1>({
	 restoreArchive(input,options={}){
	  if(cleanup.length)return Promise.reject(cleanup[0]);if(closed)return Promise.reject(new Error('Native restore runtime is closed.'));if(active)return Promise.reject(new Error('A native restore is pending.'));
	  const result=deferred<Readonly<Receipt>>(),demand:Demand={work:result.promise};active=demand;
	  let body:Blob|undefined,failed=false,primary:unknown;let detach:()=>void=()=>undefined;
	  try{
	   const descriptor=options&&typeof options==='object'?Object.getOwnPropertyDescriptor(options,'signal'):undefined;
	   const selected:unknown=descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;if(selected!==undefined)signal(selected);
	   demand.stop=forward(selected as AbortSignal|undefined);detach=()=>{demand.stop!.detach();};
	   const aborted=():void=>{void abort(demand).catch(()=>undefined);};Reflect.apply(ADD,demand.stop.signal,['abort',aborted,{once:true}]);
	   detach=()=>{Reflect.apply(REMOVE,demand.stop!.signal,['abort',aborted]);demand.stop!.detach();};
	   const captured=record(options,'native restore demand',['signal'],[]);
	   if((Object.hasOwn(captured,'signal')?field(captured,'signal','native restore demand'):undefined)!==selected)throw new TypeError('Native restore signal changed during capture.');
	   const length:unknown=Reflect.apply(SIZE,input,[]);
	   if(typeof length!=='number'||!Number.isSafeInteger(length)||length<1||length>DESKTOP_SCAPE_READ_HARD_LIMIT_BYTES)throw new RangeError('Native restore requires a bounded actual archive Blob.');
	   body=Reflect.apply(SLICE,input,[0,length]) as Blob;if(closed)demand.stop.abort();check(demand.stop.signal);
	  }catch(error){failed=true;primary=error;}
	  void(async()=>{
	   let acknowledged:Readonly<Receipt>|undefined;
	   try{
	    check(demand.stop?.signal);if(failed)throw primary;if(!body||!demand.stop)throw new Error('Native restore body was not admitted.');
	    const issued=await call(CHANNELS.begin,{name:catalogName,byteLength:Reflect.apply(SIZE,body,[]) as number});
	    // Capture a genuine scalar cleanup ID before validating the remaining
	    // reply shape, so malformed metadata cannot strand an issued stream.
	    try{if(issued&&typeof issued==='object'){const own=Object.getOwnPropertyDescriptor(issued,'id');if(own&&Object.hasOwn(own,'value'))demand.id=readId(own.value);}}catch{/* Full receipt admission below still rejects. */}
	    demand.id=beginReceipt(issued).id;check(demand.stop.signal);
	    const length=Reflect.apply(SIZE,body,[]) as number,hash=sha256.create();
	    for(let offset=0;offset<length;offset+=CHUNK){
	     check(demand.stop.signal);const end=Math.min(offset+CHUNK,length),part=Reflect.apply(SLICE,body,[offset,end]) as Blob;
	     const bytes=new Uint8Array(await(Reflect.apply(READ,part,[]) as Promise<ArrayBuffer>));
	     try{check(demand.stop.signal);if(bytes.byteLength!==end-offset)throw new Error('Actual archive Blob returned a short chunk.');hash.update(bytes);
	      const written=writeReceipt(await call(CHANNELS.write,{id:demand.id,offset,bytes}));if(written!==end)throw new Error('Native archive upload ACK changed offset.');check(demand.stop.signal);
	     }finally{bytes.fill(0);}
	    }
	    check(demand.stop.signal);
	    acknowledged=receipt(await call(CHANNELS.commit,{id:demand.id,contentSha256:bytesToHex(hash.digest())}));demand.id=undefined;
	   }catch(error){failed=true;primary=error;try{check(demand.stop?.signal);}catch(reason){primary=reason;}}
	   const failures:unknown[]=[];
	   try{if(demand.id!==undefined)await abort(demand);else await demand.aborting;}catch(error){failures.push(error);}
	   try{detach();}catch(error){notice(error);failures.push(error);}
	   if(acknowledged)return failures.length?cleanupNotice(acknowledged):acknowledged;
	   if(failures.length)throw new AggregateError([...(failed?[primary]:[]),...failures],'Native restore and actual retirement failed.');
	   if(failed)throw primary;throw new Error('Native restore had no publication acknowledgement.');
	  })().then(value=>{if(active===demand)active=undefined;result.resolve(value);},error=>{if(active===demand)active=undefined;result.reject(error);});
	  return result.promise;
	 },
	 close(){
	  if(closing)return closing;const result=deferred<void>();closing=result.promise;closed=true;const demand=active;
	  try{demand?.stop?.abort();}catch(error){notice(error);}
	  void(async()=>{await demand?.work.catch(()=>undefined);if(cleanup.length)throw new AggregateError([...cleanup],'Native restore runtime cleanup is unproved.');})().then(result.resolve,result.reject);return result.promise;
	 },
	});
}
function cleanupNotice(value:Readonly<Receipt>):Readonly<Receipt>{return value.notices.includes('cleanup-failed')?value:Object.freeze({...value,notices:Object.freeze([...value.notices,'cleanup-failed' as const])});}
