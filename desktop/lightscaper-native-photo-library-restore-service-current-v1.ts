/* SPDX-License-Identifier: AGPL-3.0-only */
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { PhotoLibraryRestoreReceiptV1 as Receipt } from '../src/common/editor/photo-library-restore-port-v1.ts';
import { readDesktopPhotoLibraryRestoreBeginCurrentV1 as beginPacket, readDesktopPhotoLibraryRestoreWriteCurrentV1 as writePacket,
	readDesktopPhotoLibraryRestoreCommitCurrentV1 as commitPacket, readDesktopPhotoLibraryRestoreAbortCurrentV1 as abortPacket,
	DESKTOP_PHOTO_LIBRARY_RESTORE_CHUNK_BYTES_CURRENT_V1 as CHUNK } from '../src/lightscaper/desktop-photo-library-restore-contract-current-v1.ts';
import { readLightscaperNativePhotoLibraryArchiveOwnerCurrentV1 as assertOwner } from './lightscaper-native-photo-library-archive-owner-current-v1.ts';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from './lightscaper-native-photo-library-scopes-current-v1.ts';
import { LightscaperNativePhotoLibraryRestoreFileCurrentV1 as File } from './lightscaper-native-photo-library-restore-file-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
interface Deferred<T>{readonly promise:Promise<T>;resolve(value:T):void;reject(error:unknown):void}
function deferred<T>():Deferred<T>{let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
interface Entry{readonly owner:object;readonly id:string;readonly stop:AbortController;file?:File;name?:string;size?:number;written:number;active?:Promise<unknown>;retiring?:Promise<void>;closing?:Promise<void>;retired:boolean;failed:boolean;failure?:unknown}
const slots=new Map<string,Entry>(),QUARANTINE=new Set<object>();
const ABORT=AbortController.prototype.abort,SIGNAL=Object.getOwnPropertyDescriptor(AbortController.prototype,'signal')!.get!;

/** Host authenticates the real frame/document before each method. Only that
	* exact owner object can use its bounded upload. Scalar IDs are not Scopes,
	* file-path, archive-body or selected-publication authority. */
export class LightscaperNativePhotoLibraryRestoreServiceCurrentV1{
	readonly #appData:string;readonly #key:string;readonly #restore:Scopes['restoreArchive'];
	readonly #closedOwners=new WeakSet<object>();#entry:Entry|undefined;#closed=false;#closing:Promise<void>|undefined;
	constructor(scopes:Scopes,appDataPath:string){
	 assertOwner(scopes);
	 if(typeof appDataPath!=='string'||!isAbsolute(appDataPath)||resolve(appDataPath)!==appDataPath||appDataPath.includes('\0')||realpathSync.native(appDataPath)!==appDataPath)throw new TypeError('Native restore requires its configured canonical appData.');
	 this.#appData=appDataPath;this.#key=process.platform==='win32'?appDataPath.toLowerCase():appDataPath;
	 const restore=Scopes.prototype.restoreArchive;this.#restore=(...args)=>Reflect.apply(restore,scopes,args) as ReturnType<typeof restore>;
	}
	begin(owner:object,value:unknown):Promise<Readonly<{id:string;maximumChunkBytes:number}>>{
	 try{this.#accept(owner);if(slots.has(this.#key))throw new Error('Native archive restore capacity is busy.');}catch(error){return Promise.reject(error);}
	 const entry:Entry={owner,id:randomBytes(32).toString('hex'),stop:new AbortController(),written:0,retired:false,failed:false};
	 const result=deferred<Readonly<{id:string;maximumChunkBytes:number}>>();entry.active=result.promise;this.#entry=entry;slots.set(this.#key,entry);
	 let captured:ReturnType<typeof beginPacket>|undefined,failed=false,primary:unknown;
	 try{captured=beginPacket(value);check(this.#signal(entry));entry.name=captured.name;entry.size=captured.byteLength;
	  entry.file=new File(this.#appData,captured.byteLength,error=>this.#quarantine(entry,error));
	 }catch(error){failed=true;primary=error;}
	 void(async()=>{
	  try{check(this.#signal(entry));if(failed)throw primary;if(!entry.file)throw new Error('Native restore has no owned stage.');await entry.file.ready();check(this.#signal(entry));return Object.freeze({id:entry.id,maximumChunkBytes:CHUNK});}
	  catch(error){let cause=error;try{check(this.#signal(entry));}catch(reason){cause=reason;}
	   try{await this.#retire(entry);}catch(cleanup){throw new AggregateError([cause,cleanup],'Native restore admission and actual retirement failed.', { cause: cleanup });}throw cause;}
	 })().then(value=>{this.#settled(entry,result.promise);result.resolve(value);},error=>{this.#settled(entry,result.promise);result.reject(error);});return result.promise;
	}
	write(owner:object,value:unknown):Promise<Readonly<{bytesWritten:number}>>{
	 let entry:Entry;try{entry=this.#find(owner);this.#dataAvailable(entry);}catch(error){return Promise.reject(error);}
	 const result=deferred<Readonly<{bytesWritten:number}>>();entry.active=result.promise;
	 let packet:ReturnType<typeof writePacket>|undefined,failed=false,primary:unknown;
	 try{packet=writePacket(value);this.#id(entry,packet.id);check(this.#signal(entry));if(packet.offset!==entry.written||packet.bytes.byteLength>(entry.size??0)-entry.written)throw new RangeError('Native restore chunk has a stale offset or leaves the upload.');}
	 catch(error){failed=true;primary=error;}
	 void(async()=>{try{check(this.#signal(entry));if(failed)throw primary;if(!packet||!entry.file)throw new Error('Native restore upload is absent.');await entry.file.write(packet.offset,packet.bytes);check(this.#signal(entry));entry.written+=packet.bytes.byteLength;return Object.freeze({bytesWritten:entry.written});}
	  finally{packet?.bytes.fill(0);}
	 })().then(value=>{this.#settled(entry,result.promise);result.resolve(value);},error=>{this.#settled(entry,result.promise);result.reject(error);});return result.promise;
	}
	commit(owner:object,value:unknown):Promise<Readonly<Receipt>>{
	 let entry:Entry;try{entry=this.#find(owner);this.#dataAvailable(entry);}catch(error){return Promise.reject(error);}
	 const result=deferred<Readonly<Receipt>>();entry.active=result.promise;let packet:ReturnType<typeof commitPacket>|undefined,admitted=false,failed=false,primary:unknown;
	 try{packet=commitPacket(value);this.#id(entry,packet.id);check(this.#signal(entry));admitted=true;}catch(error){failed=true;primary=error;}
	 void(async()=>{
	  let receipt:Readonly<Receipt>|undefined;
			if(!admitted){try{check(this.#signal(entry));}catch(reason){primary=reason;}throw primary;}
	  try{check(this.#signal(entry));if(failed)throw primary;if(!packet||!entry.file||!entry.name)throw new Error('Native restore has no accepted complete input.');
	   const source=await entry.file.finish(packet.contentSha256);check(this.#signal(entry));receipt=await this.#restore(source,{name:entry.name,signal:this.#signal(entry)});
	  }catch(error){failed=true;primary=error;if(!receipt)try{check(this.#signal(entry));}catch(reason){primary=reason;}}
	  try{await this.#retire(entry);}catch(cleanup){if(receipt)return cleanupNotice(receipt);throw new AggregateError([...(failed?[primary]:[]),cleanup],'Native archive restore and disk stage retirement failed.', { cause: cleanup });}
	  if(receipt)return receipt;if(failed)throw primary;throw new Error('Native archive restore had no publication acknowledgement.');
	 })().then(value=>{this.#settled(entry,result.promise);result.resolve(value);},error=>{this.#settled(entry,result.promise);result.reject(error);});return result.promise;
	}
	abort(owner:object,value:unknown):Promise<void>{
	 if(!owner||typeof owner!=='object')return Promise.reject(new TypeError('Native restore requires its actual document owner.'));
	 const entry=this.#entry;if(!entry)return Promise.resolve();if(entry.owner!==owner)return Promise.reject(new Error('Native restore cleanup belongs to another document.'));
	 try{this.#id(entry,abortPacket(value).id);}catch(error){return Promise.reject(error);}return this.#closeEntry(entry);
	}
	close(owner:object):Promise<void>{
	 if(!owner||typeof owner!=='object')return Promise.reject(new TypeError('Native restore requires its actual document owner.'));
	 this.#closedOwners.add(owner);const entry=this.#entry;return entry?.owner===owner?this.#closeEntry(entry):Promise.resolve();
	}
	closeAll():Promise<void>{
	 if(this.#closing)return this.#closing;const result=deferred<void>();this.#closing=result.promise;this.#closed=true;
	 const work=this.#entry?this.#closeEntry(this.#entry):Promise.resolve();void work.then(result.resolve,result.reject);return result.promise;
	}
	#closeEntry(entry:Entry):Promise<void>{
	 if(entry.closing)return entry.closing;const result=deferred<void>();entry.closing=result.promise;
	 try{Reflect.apply(ABORT,entry.stop,[new DOMException('Native archive restore was cancelled.','AbortError')]);}catch(error){this.#quarantine(entry,error);}
	 // Eagerly stop real file hashing/reads as well as Scopes. Neither actual
	 // completion is raced away, and cleanup owns a separate cached lane.
	 const physical=entry.file?this.#retire(entry):undefined;void physical?.catch(()=>undefined);
	 void(async()=>{await entry.active?.catch(()=>undefined);if(physical)await physical;else await this.#retire(entry);
	  if(entry.failed)throw entry.failure;this.#release(entry);
	 })().then(result.resolve,result.reject);return result.promise;
	}
	#retire(entry:Entry):Promise<void>{
	 if(entry.retiring)return entry.retiring;const result=deferred<void>();entry.retiring=result.promise;
	 let actual:Promise<void>;try{actual=entry.file?.close()??Promise.resolve();}catch(error){actual=Promise.reject(error);}
	 void actual.then(()=>{entry.retired=true;result.resolve();},error=>{this.#quarantine(entry,error);result.reject(error);});return result.promise;
	}
	#accept(owner:object):void{if(this.#closed||this.#closedOwners.has(owner))throw new Error('Native restore document is closed.');if(!owner||typeof owner!=='object')throw new TypeError('Native restore requires its actual document owner.');const held=slots.get(this.#key);if(held?.failed)throw held.failure;}
	#find(owner:object):Entry{this.#accept(owner);const entry=this.#entry;if(!entry||entry.owner!==owner)throw new Error('Native restore belongs to another or absent document.');return entry;}
	#dataAvailable(entry:Entry):void{if(entry.closing||entry.active||entry.retired)throw new Error('Native restore stream is busy or closing.');}
	#id(entry:Entry,id:string):void{if(entry.id!==id)throw new Error('Native restore handle belongs to another stream.');}
	#signal(entry:Entry):AbortSignal{return Reflect.apply(SIGNAL,entry.stop,[]) as AbortSignal;}
	#settled(entry:Entry,work:Promise<unknown>):void{if(entry.active===work)entry.active=undefined;if(entry.retired&&!entry.failed)this.#release(entry);}
	#release(entry:Entry):void{if(entry.failed)return;if(slots.get(this.#key)===entry)slots.delete(this.#key);if(this.#entry===entry)this.#entry=undefined;}
	#quarantine(entry:Entry,error:unknown):void{entry.failed=true;entry.failure??=error;QUARANTINE.add({service:this,entry});}
}
function cleanupNotice(receipt:Readonly<Receipt>):Readonly<Receipt>{return receipt.notices.includes('cleanup-failed')?receipt:Object.freeze({...receipt,notices:Object.freeze([...receipt.notices,'cleanup-failed' as const])});}
