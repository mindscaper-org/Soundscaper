/* SPDX-License-Identifier: AGPL-3.0-only */
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import type {DesktopPhotoOriginalStorageCurrentV1 as Storage,DesktopPhotoOriginalDirectoryCurrentV1 as Directory,DesktopPhotoOriginalWritableCurrentV1 as Writable} from './desktop-photo-original-contract-current-v1.ts';
import type {DesktopPhotoLinkedInputFactsCurrentV1 as Facts} from './desktop-photo-linked-contract-current-v1.ts';
const NativeFile=File,CHECK=AbortSignal.prototype.throwIfAborted,SLICE=Blob.prototype.slice,READ=Blob.prototype.arrayBuffer;
const TYPE=Object.getOwnPropertyDescriptor(Blob.prototype,'type')!.get!;
const SIZE=Object.getOwnPropertyDescriptor(Blob.prototype,'size')!.get!,NAME=Object.getOwnPropertyDescriptor(File.prototype,'name')!.get!;
const DOM_NAME=Object.getOwnPropertyDescriptor(DOMException.prototype,'name')!.get!;
const TYPED=Object.getPrototypeOf(Uint8Array.prototype) as object,TAG=Object.getOwnPropertyDescriptor(TYPED,Symbol.toStringTag)!.get!,LENGTH=Object.getOwnPropertyDescriptor(TYPED,'byteLength')!.get!,BUFFER=Object.getOwnPropertyDescriptor(TYPED,'buffer')!.get!,AB_LENGTH=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength')!.get!;
const SET=Uint8Array.prototype.set,FILL=Uint8Array.prototype.fill;
const check=(signal:AbortSignal):void=>{Reflect.apply(CHECK,signal,[]);};
/** A pre-Photo input stage has byte facts, never a fabricated Original ticket. */
export class DesktopPhotoLinkedInputBodyCurrentV1{
 #snapshot:File|undefined;#parent:Directory|undefined;#name:string|undefined;#owned=false;#writer:Writable|undefined;#abort=false;#closing:Promise<void>|undefined;
 async materialize(storage:Storage,createId:()=>string,facts:Readonly<Facts>,read:(offset:number,length:number)=>Promise<unknown>,signal:AbortSignal):Promise<File>{
  check(signal);const root=await storage.getDirectory();check(signal);this.#parent=await root.getDirectoryHandle('lightscaper-desktop-linked-input-staging-v1',{create:true});check(signal);const token=createId();
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(token))throw new TypeError('Linked input stage needs its owned random directory ID.');this.#name=`input-${token}`;
  try{await this.#parent.getDirectoryHandle(this.#name,{create:false});throw new Error('Linked input stage already exists.');}catch(error){if(!notFound(error))throw error;}check(signal);
  const directory=await this.#parent.getDirectoryHandle(this.#name,{create:true});this.#owned=true;check(signal);const handle=await directory.getFileHandle('body.bin',{create:true});check(signal);this.#writer=await handle.createWritable({keepExistingData:false});this.#abort=true;check(signal);
  for(let offset=0;offset<facts.byteLength;){const length=Math.min(1048576,facts.byteLength-offset);check(signal);const value=await read(offset,length);let bytes:Uint8Array<ArrayBuffer>;try{check(signal);bytes=copy(value,length);}finally{wipePull(value);}try{await this.#writer.write(bytes);check(signal);}finally{Reflect.apply(FILL,bytes,[0]);}offset+=length;}
  check(signal);await this.#writer.close();this.#abort=false;check(signal);const actual=await handle.getFile();check(signal);if(Reflect.apply(SIZE,actual,[])!==facts.byteLength||Reflect.apply(NAME,actual,[])!=='body.bin')throw new Error('Linked staged input requires the exact genuine OPFS File.');this.#snapshot=actual as File;const file=this.#snapshot;
  if(await digest(file,signal)!==facts.contentSha256)throw new Error('Linked staged input SHA differs from its native file.');check(signal);const named=new NativeFile([this.#snapshot],facts.displayName,{type:Reflect.apply(TYPE,file,[]) as string,lastModified:0});if(Reflect.apply(SIZE,named,[])!==facts.byteLength||Reflect.apply(NAME,named,[])!==facts.displayName)throw new Error('Linked File metadata differs from the actual native filename.');return named;
 }
 retire(reason?:unknown):Promise<void>{this.#closing??=Promise.resolve().then(async()=>{if(this.#abort&&this.#writer){await this.#writer.abort(reason);this.#abort=false;}if(this.#owned&&this.#parent&&this.#name){try{await this.#parent.removeEntry(this.#name,{recursive:true});}catch(error){if(!notFound(error))throw error;}this.#owned=false;}this.#snapshot=undefined;});return this.#closing;}
}
function copy(value:unknown,length:number):Uint8Array<ArrayBuffer>{if(Reflect.apply(TAG,value,[])!=='Uint8Array'||Reflect.apply(LENGTH,value,[])!==length)throw new RangeError('Linked native pull differs from its exact bounded interval.');Reflect.apply(AB_LENGTH,Reflect.apply(BUFFER,value,[]),[]);const bytes=new Uint8Array(length);Reflect.apply(SET,bytes,[value]);return bytes;}
async function digest(file:File,signal:AbortSignal):Promise<string>{const size=Number(Reflect.apply(SIZE,file,[])),hash=sha256.create();try{for(let offset=0;offset<size;offset+=1048576){check(signal);const length=Math.min(1048576,size-offset),slice=Reflect.apply(SLICE,file,[offset,offset+length]) as Blob,buffer=await Reflect.apply(READ,slice,[]) as ArrayBuffer,bytes=new Uint8Array(buffer);try{check(signal);if(bytes.byteLength!==length)throw new Error('Linked stage hash read has wrong length.');hash.update(bytes);}finally{Reflect.apply(FILL,bytes,[0]);}}const bytes=hash.digest();try{return bytesToHex(bytes);}finally{Reflect.apply(FILL,bytes,[0]);}}finally{hash.destroy();}}
function notFound(value:unknown):boolean{try{return Reflect.apply(DOM_NAME,value,[])==='NotFoundError';}catch{return false;}}
function wipePull(value:unknown):void{try{if(Reflect.apply(TAG,value,[])==='Uint8Array'&&Number(Reflect.apply(LENGTH,value,[]))<=1048576)Reflect.apply(FILL,value,[0]);}catch{/* Only an admitted native byte backing can be wiped. */}}
