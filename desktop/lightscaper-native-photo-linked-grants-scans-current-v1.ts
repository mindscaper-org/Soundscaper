/* SPDX-License-Identifier: AGPL-3.0-only */
import type {NativePath,NativeRoot,NativeScan,NativePage} from './lightscaper-native-photo-granted-filesystem-current-v1.ts';
import {lightscaperNativePhotoGrantedFilesystemRetirementIsUnprovedCurrentV1 as unproved} from './lightscaper-native-photo-granted-filesystem-current-v1.ts';
import {captureComponents} from './lightscaper-native-photo-granted-filesystem-codec-current-v1.ts';
import {linkedGrantIdCurrentV1 as id,type LinkedGrantRowCurrentV1 as Row} from './lightscaper-native-photo-linked-grants-records-current-v1.ts';
import {createLinkedGrantCleanupFailureCurrentV1 as cleanup,combineLinkedGrantFailuresCurrentV1 as combine} from './lightscaper-native-photo-linked-grants-failures-current-v1.ts';
export type LinkedGrantScanCaptureCurrentV1=Readonly<object>;
export type LinkedGrantScanCurrentV1=Readonly<NativeScan&{assertCurrent():void}>;
type Snapshot=Readonly<{row:Row;components:readonly NativePath[]}>;
type Ports=Readonly<{snapshot(id:string):Row;current(snapshot:Snapshot):void;open(path:NativePath,identity:Row['identity']):Promise<NativeRoot>;fail(error:unknown):void}>;
interface Entry{readonly snapshot:Snapshot;readonly opened:Promise<void>;openedDone():void;readonly active:Set<Promise<unknown>>;stopped:boolean;root?:NativeRoot;scan?:NativeScan;closing?:Promise<void>;retired?:Promise<void>;busy:boolean}
/** Scans are grant-owned real native handles. Revoke fences and joins them;
 * entries never become body proof and no per-call signal reaches the peer. */
export class LinkedGrantScansCurrentV1{
 readonly #ports:Ports;readonly #captures=new WeakMap<object,Snapshot>();readonly #entries=new Set<Entry>();#closed=false;#closing:Promise<void>|undefined;
 constructor(ports:Ports){this.#ports=ports;}
 capture(grantId:unknown,components:unknown):LinkedGrantScanCaptureCurrentV1{
  if(this.#closed)throw new Error('Native grant scan admission is closed.');const snapshot=Object.freeze({row:this.#ports.snapshot(id(grantId)),components:captureComponents(components,true)});this.#ports.current(snapshot);const proof=Object.freeze({});this.#captures.set(proof,snapshot);return proof;
 }
 open(value:LinkedGrantScanCaptureCurrentV1):Promise<LinkedGrantScanCurrentV1>{
  const snapshot=this.#captures.get(value);if(this.#closed||!snapshot)return Promise.reject(new TypeError('A genuine current native grant scan capture is required.'));
  if(this.#entries.size>=4)return Promise.reject(new RangeError('Native grant scan capacity is busy.'));
  let openedDone!:()=>void;const opened=new Promise<void>(resolve=>{openedDone=resolve;}),entry:Entry={snapshot,opened,openedDone,active:new Set(),stopped:false,busy:false};this.#entries.add(entry);
  return this.#open(entry).finally(openedDone);
 }
 #check(entry:Entry):void{if(this.#closed||entry.stopped)throw new Error('Native grant scan is retiring.');this.#ports.current(entry.snapshot);}
 async #open(entry:Entry):Promise<LinkedGrantScanCurrentV1>{
  try{this.#check(entry);entry.root=await this.#ports.open(entry.snapshot.row.path,entry.snapshot.row.identity);this.#check(entry);entry.scan=await entry.root.openScan(entry.snapshot.components);this.#check(entry);
   await entry.root.close();entry.root=undefined;this.#check(entry);const scan=entry.scan;
   return Object.freeze({assertCurrent:()=>{this.#check(entry);},next:():Promise<NativePage>=>{
    try{this.#check(entry);if(entry.busy)throw new Error('Native grant scan pull is busy.');}catch(error){return Promise.reject(error);}entry.busy=true;
    const work=(async()=>{this.#check(entry);const page=await scan.next();this.#check(entry);return page;})();entry.active.add(work);void work.then(()=>{entry.active.delete(work);entry.busy=false;},()=>{entry.active.delete(work);entry.busy=false;});return work;
   },close:()=>this.#close(entry)});
  }catch(primary){try{await this.#retire(entry);}catch(error){throw combine([primary,error],'Native scan open and retirement failed.');}if(unproved(primary))this.#ports.fail(primary);throw primary;}
 }
 #retire(entry:Entry):Promise<void>{
  if(entry.retired)return entry.retired;entry.stopped=true;entry.retired=Promise.resolve().then(async()=>{
   await Promise.allSettled([...entry.active]);const errors:unknown[]=[];try{await entry.scan?.close();}catch(error){errors.push(error);}try{await entry.root?.close();}catch(error){errors.push(error);}
   if(errors.length){const failure=cleanup(errors,'Native grant scan retirement is unproved.');this.#ports.fail(failure);throw failure;}this.#entries.delete(entry);
  });return entry.retired;
 }
 #close(entry:Entry):Promise<void>{entry.stopped=true;entry.closing??=entry.opened.then(()=>this.#retire(entry));return entry.closing;}
 async revoke(grantId:string):Promise<void>{const entries=[...this.#entries].filter(entry=>entry.snapshot.row.grant.grantId===grantId);for(const entry of entries)entry.stopped=true;const results=await Promise.allSettled(entries.map(entry=>this.#close(entry)));const errors=results.flatMap(value=>value.status==='rejected'?[value.reason as unknown]:[]);if(errors.length)throw combine(errors,'Revoked native scans did not retire.');}
 close():Promise<void>{if(this.#closing)return this.#closing;this.#closed=true;const entries=[...this.#entries];for(const entry of entries)entry.stopped=true;this.#closing=Promise.allSettled(entries.map(entry=>this.#close(entry))).then(results=>{const errors=results.flatMap(value=>value.status==='rejected'?[value.reason as unknown]:[]);if(errors.length)throw combine(errors,'Native grant scans did not retire.');});return this.#closing;}
}
