/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash, randomBytes } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { chmod, lstat, mkdir, open, realpath, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createScapeArchiveByteSource, type ScapeArchiveByteSource } from '../src/common/scape/archive-byte-source.ts';
import { SCAPE_MAXIMUM_CENTRAL_DIRECTORY_BYTES } from '../src/common/scape/archive-zip-profile.ts';
import { DESKTOP_PHOTO_LIBRARY_RESTORE_CHUNK_BYTES_CURRENT_V1 as CHUNK } from '../src/lightscaper/desktop-photo-library-restore-contract-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
const QUARANTINE = new Set<object>(), NativeBytes = Uint8Array;
const ABORT = AbortController.prototype.abort, SIGNAL = Object.getOwnPropertyDescriptor(AbortController.prototype,'signal')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object,'byteLength')!.get!;
interface Deferred<T> { readonly promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }
function deferred<T>(): Deferred<T> { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes,no) => { resolve=yes; reject=no; }); return { promise,resolve,reject }; }
function same(a: BigIntStats,b: BigIntStats): boolean { return a.dev===b.dev && a.ino===b.ino && a.size===b.size && a.mtimeNs===b.mtimeNs && a.ctimeNs===b.ctimeNs; }
function absent(error: unknown): boolean { return error!==null && typeof error==='object' && 'code' in error && error.code==='ENOENT'; }

/** Actual disk owner for a single archive upload. It is independent of Media
	* SQL and never manufactures an Original publication proof or native path DTO. */
export class LightscaperNativePhotoLibraryRestoreFileCurrentV1 {
	readonly #root: string; readonly #size: number; readonly #quarantine: (error: unknown) => void;
	readonly #stop = new AbortController(); readonly #active = new Set<Promise<unknown>>(); readonly #handles = new Set<FileHandle>();
	readonly #cleanup: unknown[] = [];
	#output: FileHandle | undefined; #input: FileHandle | undefined; #created: BigIntStats | undefined; #stamp: BigIntStats | undefined;
	#path=''; #written=0; #allocated=false; #closed=false; #writing=false; #reading=false;
	readonly #opening: Promise<void>; #finishing: Promise<ScapeArchiveByteSource> | undefined; #closing: Promise<void> | undefined;
	constructor(appDataPath: string,size: number,quarantine: (error: unknown) => void) {
	 this.#root=join(appDataPath,'Lightscaper','project-library','v1','native-photo-library-restore-staging'); this.#size=size; this.#quarantine=quarantine;
	 this.#opening=this.#open(); void this.#opening.catch(()=>undefined);
	}
	ready(): Promise<void> { return this.#opening.then(()=>{this.#check();}); }
	write(offset: number,value: Uint8Array): Promise<void> {
	 try { this.#check(); if(this.#writing || this.#finishing) throw new Error('Native archive upload is sealed or busy.'); }
	 catch(error) { return Promise.reject(error); }
	 const result=deferred<void>(); this.#writing=true; this.#active.add(result.promise);
	 let bytes: Uint8Array | undefined,failed=false,primary: unknown;
	 try {
	  const length: unknown=Reflect.apply(LENGTH,value,[]);
	  if(!(value instanceof NativeBytes) || typeof length!=='number' || length<1 || length>CHUNK || offset!==this.#written || length>this.#size-offset) throw new RangeError('Native archive chunk leaves its exact upload.');
	  bytes=new NativeBytes(value);
	 } catch(error) {failed=true;primary=error;}
	 void (async()=>{
	  await this.#opening; this.#check(); if(failed) throw primary;
	  if(!bytes || !this.#output) throw new Error('Native archive upload has no actual output.');
	  for(let written=0;written<bytes.byteLength;) {
	   this.#check(); const ack=await this.#output.write(bytes,written,bytes.byteLength-written,offset+written);
	   if(ack.bytesWritten<1) throw new Error('Native archive upload write made no progress.'); written+=ack.bytesWritten;
	  }
	  this.#check(); this.#written+=bytes.byteLength;
	 })().then(()=>{bytes?.fill(0);this.#writing=false;this.#active.delete(result.promise);result.resolve();},error=>{bytes?.fill(0);this.#writing=false;this.#active.delete(result.promise);result.reject(error);}); return result.promise;
	}
	finish(expectedSha256: string): Promise<ScapeArchiveByteSource> {
	 if(this.#finishing) return this.#finishing;
	 try {this.#check();if(this.#writing) throw new Error('Native archive upload write is pending.');} catch(error){return Promise.reject(error);}
	 const result=deferred<ScapeArchiveByteSource>();this.#finishing=result.promise;this.#active.add(result.promise);
	 void (async()=>{
	  await this.#opening;this.#check();if(this.#written!==this.#size || !this.#output) throw new Error('Native archive upload is incomplete.');
	  await this.#output.sync();
	  try {await this.#output.close();this.#output=undefined;} catch(error){this.#failedCleanup(error);throw error;}
	  this.#check();await this.#directory(this.#root,false);
	  this.#input=await open(this.#path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));this.#stamp=await this.#input.stat({bigint:true});await this.#verify();
	  const hash=createHash('sha256');
	  for(let offset=0;offset<this.#size;){const bytes=await this.#range(offset,Math.min(CHUNK,this.#size-offset));try{hash.update(bytes);offset+=bytes.byteLength;}finally{bytes.fill(0);}}
	  if(hash.digest('hex')!==expectedSha256) throw new Error('Native completed archive SHA differs from its uploaded declaration.');
	  await this.#syncDirectory(this.#root);this.#check();
	  return createScapeArchiveByteSource({size:this.#size,maximumReadBytes:SCAPE_MAXIMUM_CENTRAL_DIRECTORY_BYTES,read:request=>this.#read(request.offset,request.length)});
	 })().then(value=>{this.#active.delete(result.promise);result.resolve(value);},error=>{this.#active.delete(result.promise);result.reject(error);});return result.promise;
	}
	close(): Promise<void> {
	 if(this.#closing)return this.#closing;const result=deferred<void>();this.#closing=result.promise;this.#closed=true;
	 try{Reflect.apply(ABORT,this.#stop,[new DOMException('Native archive stage is closing.','AbortError')]);}catch(error){this.#failedCleanup(error);}
	 const active=[this.#opening,...this.#active];
	 void Promise.allSettled(active).then(async()=>{
	  const errors:unknown[]=[...this.#cleanup];
	  for(const key of ['output','input'] as const){const handle=key==='output'?this.#output:this.#input;if(!handle)continue;
	   try{await handle.close();if(key==='output')this.#output=undefined;else this.#input=undefined;}catch(error){errors.push(error);this.#failedCleanup(error);}}
	  if(this.#allocated&&!this.#created){const error=new Error('Native archive created-file identity is unproved.');errors.push(error);this.#failedCleanup(error);}
	  if(!errors.length&&this.#created)try{
	   await this.#directory(this.#root,false);let actual:BigIntStats|undefined;
	   try{actual=await lstat(this.#path,{bigint:true});}catch(error){if(!absent(error))throw error;}
	   if(actual){if(!actual.isFile()||actual.isSymbolicLink()||actual.nlink!==1n||actual.dev!==this.#created.dev||actual.ino!==this.#created.ino)throw new Error('Native archive cleanup refuses a replaced upload.');
	    await unlink(this.#path);await this.#syncDirectory(this.#root);}
	  }catch(error){errors.push(error);this.#failedCleanup(error);}
	  if(errors.length)throw new AggregateError(errors,'Native archive disk stage retirement is unproved.');
	 }).then(result.resolve,result.reject);return result.promise;
	}
	#read(offset:number,length:number):Promise<Uint8Array>{
	 try{this.#check();if(this.#reading)throw new Error('Native archive source read capacity is busy.');}catch(error){return Promise.reject(error);}
	 const result=deferred<Uint8Array>();this.#reading=true;this.#active.add(result.promise);
	 void this.#range(offset,length).then(bytes=>{this.#reading=false;this.#active.delete(result.promise);result.resolve(bytes);},error=>{this.#reading=false;this.#active.delete(result.promise);result.reject(error);});return result.promise;
	}
	async #range(offset:number,length:number):Promise<Uint8Array>{
	 this.#check();if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<0||length>SCAPE_MAXIMUM_CENTRAL_DIRECTORY_BYTES||offset>this.#size-length)throw new RangeError('Native archive source range leaves its ZIP profile.');
	 await this.#verify();this.#check();const bytes=new NativeBytes(length);
	 try{if(!this.#input)throw new Error('Native archive has no completed file.');
	  for(let read=0;read<length;){this.#check();const ack=await this.#input.read(bytes,read,Math.min(CHUNK,length-read),offset+read);if(ack.bytesRead<1)throw new Error('Native archive source ended before its exact range.');read+=ack.bytesRead;}
	  await this.#verify();this.#check();return bytes;
	 }catch(error){bytes.fill(0);throw error;}
	}
	async #verify():Promise<void>{
	 if(!this.#input||!this.#stamp||!this.#created)throw new Error('Native archive has no proved completed file.');
	 const actual=await this.#input.stat({bigint:true}),path=await lstat(this.#path,{bigint:true});
	 if(!actual.isFile()||actual.nlink!==1n||!path.isFile()||path.isSymbolicLink()||path.nlink!==1n||actual.size!==BigInt(this.#size)
	  ||actual.dev!==this.#created.dev||actual.ino!==this.#created.ino||!same(this.#stamp,actual)||!same(actual,path)||await realpath(this.#path)!==this.#path)throw new Error('Native completed archive file changed identity.');
	}
	#check():void{check(Reflect.apply(SIGNAL,this.#stop,[]) as AbortSignal);if(this.#cleanup.length)throw this.#cleanup[0];if(this.#closed)throw new Error('Native archive disk stage is closed.');}
	#failedCleanup(error:unknown):void{if(!this.#cleanup.some(value=>Object.is(value,error)))this.#cleanup.push(error);QUARANTINE.add(this);this.#quarantine(error);}
	async #open():Promise<void>{
	 await this.#directory(dirname(this.#root),false);await this.#directory(this.#root,true);this.#check();
	 this.#path=join(this.#root,`archive-${randomBytes(32).toString('hex')}.part`);
	 this.#output=await open(this.#path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW??0),0o600);this.#allocated=true;
	 this.#created=await this.#output.stat({bigint:true});if(!this.#created.isFile()||this.#created.nlink!==1n)throw new Error('Native archive stage requires its private regular file.');this.#check();
	}
	async #directory(path:string,create:boolean):Promise<void>{
	 let made=false;if(create)try{await mkdir(path,{mode:0o700});made=true;}catch(error){if(!(error&&typeof error==='object'&&'code'in error&&error.code==='EEXIST'))throw error;}
	 const actual=await lstat(path);if(!actual.isDirectory()||actual.isSymbolicLink()||await realpath(path)!==path)throw new Error('Native archive staging requires canonical real directories.');
	 if(made)await chmod(path,0o700);if(create)await this.#syncDirectory(dirname(path));
	}
	async #syncDirectory(path:string):Promise<void>{
	 if(process.platform==='win32')return;const handle=await open(path,constants.O_RDONLY);let failed=false,primary:unknown;
	 try{await handle.sync();}catch(error){failed=true;primary=error;}
	 try{await handle.close();}catch(error){this.#handles.add(handle);this.#failedCleanup(error);throw new AggregateError([...(failed?[primary]:[]),error],'Native archive directory retirement failed.', { cause: error });}
	 if(failed)throw primary;
	}
}
