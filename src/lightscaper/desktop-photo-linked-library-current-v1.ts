/* SPDX-License-Identifier: AGPL-3.0-only */
import {readClosedDomainRecord as record,readClosedDomainField as field,readClosedDomainArray as array} from '../common/editor/closed-domain-value.ts';
import type {PhotoLibraryImportRequestOptionsV1 as ImportOptions} from '../common/editor/photo-library-import-settings-port-v1.ts';
import type {PhotoLibraryImportItemV1 as Item} from '../common/editor/photo-library-session-port-v1.ts';
import type {PhotoLibraryDevelopImportRequestCurrentV1 as DevelopRequest} from '../common/editor/photo-library-develop-import-port-current-v1.ts';
import type {PhotoLibraryRawImportSourceCurrentV1 as RawImport} from './controller/photo-library-raw-import-current-v1.ts';
import {capturePhotoLibraryRawImportSourceCurrentV1 as captureRaw} from './controller/photo-library-raw-import-current-v1.ts';
import {admitPhotoLibraryImportRequestV1 as importOptions} from './controller/photo-library-import-request.ts';
import {admitPhotoLibraryDevelopImportRequestCurrentV1 as developRequest} from './controller/photo-library-develop-import-request-current-v1.ts';
import {PhotoLibrarySessionCurrentV1 as Session} from './controller/photo-library-session-current-v1.ts';
import {readPhotoStackSignalOptionsV1 as signalOptions} from './catalog/photo-stack-repository-contract-v1.ts';
import {normalizePhotoDocumentV1 as photo} from './catalog/photo-document.ts';
import {normalizePhotoDocumentCurrentV1 as currentPhoto} from './catalog/photo-document-current-v1.ts';
import type {PhotoDocumentCurrentV1} from './catalog/photo-document-current-v1.ts';
import {preparePhotoImportGestureCurrentV1 as preparing} from './import/photo-import-preparation-current-v1.ts';
import type {PhotoImportOutcomeCurrentV1 as Outcome} from './import/photo-import-preparation-current-v1.ts';
import {normalizePhotoImportSettingsV1} from './import/photo-import-settings-v1.ts';
import {IMAGE_IMPORT_LIMITS} from '../common/editor/image-import-admission.ts';
import {DesktopPhotoLinkedInputSourceCurrentV1 as Source} from './desktop-photo-linked-input-stage-current-v1.ts';
import {readDesktopPhotoLibrarySessionHandleCurrentV1 as handle} from './desktop-photo-library-session-protocol-current-v1.ts';
import {desktopPhotoLinkedIdCurrentV1 as token,type DesktopPhotoLinkedInputReceiptCurrentV1 as Receipt} from './desktop-photo-linked-contract-current-v1.ts';
import type {DesktopPhotoOriginalSourceOptionsCurrentV1 as SourceOptions} from './desktop-photo-original-contract-current-v1.ts';
import type {DesktopPhotoLinkedLibraryPortCurrentV1 as Port,DesktopPhotoLinkedScanCurrentV1 as Scan} from './desktop-photo-linked-port-current-v1.ts';
type Options=Readonly<{signal?:AbortSignal}>;
type Selection=Readonly<{scan:Scan;entryIds:readonly string[]}>;
type Lease=Awaited<ReturnType<Source['acquire']>>;
type Bound=Readonly<{receipt:Readonly<Receipt>;lease:Lease}>;
type Request=ImportOptions|DevelopRequest;
import {normalizeCatalogOriginalRepairBindingV1 as repairBinding,type CatalogOriginalRepairBindingV1 as RepairBinding} from '../common/editor/storage/media-catalog-original-repair-contract.ts';
type Publication=Readonly<{sourceId:string;sha256:string;size:number}>;
type Work=Readonly<{controller:AbortController;promise:Promise<unknown>}>;
const Controller=AbortController,CHECK=AbortSignal.prototype.throwIfAborted,ABORT=AbortController.prototype.abort;
const ADD=EventTarget.prototype.addEventListener,REMOVE=EventTarget.prototype.removeEventListener;
const REASON=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'reason')!.get!;
const SESSIONS=new WeakMap<object,DesktopPhotoLinkedLibraryCurrentV1>();
/** This selector never reflects an arbitrary Session-shaped object. Native
 * filesystem authority remains entirely inside the selected Main connection. */
export function getDesktopPhotoLinkedLibraryCurrentV1(value:unknown):DesktopPhotoLinkedLibraryCurrentV1|null{
 return value!==null&&typeof value==='object'?SESSIONS.get(value)??null:null;
}
/** Trusted complete-factory local owner. Each selected native input remains
 * leased through actual Current decoding, resource publication and recovery. */
export class DesktopPhotoLinkedLibraryCurrentV1{
 readonly #port:Readonly<Port>;readonly #source:Source;readonly #parent:AbortSignal;readonly #detach:()=>void;
 readonly #fallback:Readonly<RawImport>|undefined;readonly #files=new WeakMap<File,Bound>();readonly #inputs=new Map<string,Bound>();
 readonly #scans=new Map<string,Scan>();readonly #pending=new Set<Work>();readonly #cleanup:unknown[]=[];
 #stopped=false;#importing:object|undefined;#sourceClosing:Promise<void>|undefined;#closing:Promise<void>|undefined;
 #session:Session|undefined;#sessionImport:Session['importFiles']|undefined;#develop:NonNullable<Session['developImportCurrent']>|undefined;
 #readPage:Session['readPage']|undefined;
 constructor(port:Readonly<Port>,options:Readonly<{signal:AbortSignal;sourceOptions?:SourceOptions;rawImport?:Readonly<RawImport>}>){
  const captured:Partial<Record<keyof Port,unknown>>={};
  for(const key of ['inspectOriginal','readOriginalsPage','chooseFolder','readGrants','openScan','nextScan','closeScan','openInput','readInput','closeInput','publishInput','relinkInput','revoke'] as const){const method=port[key];if(typeof method!=='function')throw new TypeError('Complete linked library port is required.');captured[key]=(...args:unknown[])=>Reflect.apply(method,port,args) as unknown;}
  const raw=port.rawImport;if(raw!==undefined&&typeof raw!=='function')throw new TypeError('Linked RAW source must be callable.');if(raw)captured.rawImport=(value:Parameters<NonNullable<Port['rawImport']>>[0])=>Reflect.apply(raw,port,[value]) as ReturnType<NonNullable<Port['rawImport']>>;
  this.#port=Object.freeze(captured) as unknown as Readonly<Port>;this.#fallback=captureRaw(options.rawImport);this.#parent=options.signal;
  this.#source=new Source({read:this.#port.readInput,close:this.#port.closeInput},options.sourceOptions);
  const stop=():void=>{this.#stop();};Reflect.apply(ADD,this.#parent,['abort',stop,{once:true}]);this.#detach=()=>{Reflect.apply(REMOVE,this.#parent,['abort',stop]);};
  if(this.#parent.aborted)this.#stop();this.#check();
 }
 bind(session:Session):void{
  this.#check();if(!(session instanceof Session))throw new TypeError('A genuine Current Session is required.');if(this.#session||SESSIONS.has(session))throw new Error('Linked library is already bound.');
  const imported=session.importFiles,read=session.readPage,develop=session.developImportCurrent;
  if(typeof imported!=='function'||typeof read!=='function'||!develop||typeof develop.importFiles!=='function')throw new TypeError('Actual complete Current Session import children required.');
  this.#session=session;this.#sessionImport=(...args)=>Reflect.apply(imported,session,args) as ReturnType<typeof imported>;this.#readPage=(...args)=>Reflect.apply(read,session,args) as ReturnType<typeof read>;
  const importDevelop=develop.importFiles,list=develop.listPresets;
  this.#develop=Object.freeze({schemaVersion:3,importFiles:(...args:Parameters<typeof importDevelop>)=>Reflect.apply(importDevelop,develop,args) as ReturnType<typeof importDevelop>,listPresets:(...args:Parameters<typeof list>)=>Reflect.apply(list,develop,args) as ReturnType<typeof list>});SESSIONS.set(session,this);
 }
 readonly readOriginalsPage=(cursor:string|null=null,options?:Options)=>this.#run(()=>{const request=signalOptions(options??{}),read=this.#bound().readPage;if(cursor!==null&&(typeof cursor!=='string'||new TextEncoder().encode(cursor).byteLength>4096))throw new RangeError('Linked cursor exceeds4KiB.');return{signal:request.signal,work:async(signal:AbortSignal)=>{await read({signal});check(signal);this.#check();const result=await this.#port.readOriginalsPage(cursor,{signal});check(signal);this.#check();return result;}};});
 readonly inspectOriginal=(value:RepairBinding,options?:Options)=>this.#run(()=>{const request=signalOptions(options??{}),binding=repairBinding(value);return{signal:request.signal,work:async(signal:AbortSignal)=>{const result=await this.#port.inspectOriginal(binding,{signal});check(signal);this.#check();return result;}};});
 readonly revoke=(grantId:string,options?:Options)=>this.#run(()=>{const request=signalOptions(options??{}),id=token(grantId);return{signal:request.signal,work:(signal:AbortSignal)=>this.#port.revoke(id,{signal})};});
 readonly relinkEntry=(value:unknown,bindingValue:RepairBinding,expectedRevision:number,options?:Options)=>this.#run(()=>{
  const request=signalOptions(options??{}),r=record(value,'linked relink selection',['scan','entryId']),scan=this.#scan(field(r,'scan','linked relink selection')),entryId=token(field(r,'entryId','linked relink selection')),binding=repairBinding(bindingValue);
  if(!Number.isSafeInteger(expectedRevision)||Object.is(expectedRevision,-0)||expectedRevision<0||expectedRevision>=Number.MAX_SAFE_INTEGER)throw new RangeError('Linked relink revision is invalid.');
  return{signal:request.signal,work:async(signal:AbortSignal)=>{const input=await this.#port.openInput(scan,entryId,{signal});let failed=false,primary:unknown,result:Awaited<ReturnType<Port['relinkInput']>>|undefined;
   try{if(input.facts.contentSha256!==binding.sha256||input.facts.byteLength!==binding.size)throw new Error('Relink requires the exact immutable Original bytes.');check(signal);this.#check();result=await this.#port.relinkInput(input.handle,binding,expectedRevision,{signal});}catch(error){failed=true;primary=error;}
   try{await this.#port.closeInput(input.handle);}catch(error){this.#fail(error);throw combine([...(failed?[primary]:[]),error],'Linked relink and native input retirement failed.');}if(failed)throw primary;return result!;
  }};
 });
 readonly chooseFolder=(options?:Options)=>this.#run(()=>{const request=signalOptions(options??{});return{signal:request.signal,work:(signal:AbortSignal)=>this.#port.chooseFolder({signal})};});
 readonly readGrants=(after:string|null=null,options?:Options)=>this.#run(()=>{const request=signalOptions(options??{}),cursor=after===null?null:token(after);return{signal:request.signal,work:async(signal:AbortSignal)=>{const page=await this.#port.readGrants(cursor,{signal});check(signal);this.#check();return page;}};});
 readonly openScan=(grantId:string,entryId?:string,options?:Options)=>this.#run(()=>{const request=signalOptions(options??{}),grant=token(grantId),entry=entryId===undefined?undefined:token(entryId);return{signal:request.signal,work:async(signal:AbortSignal)=>{
  const scan=await this.#port.openScan(grant,entry,{signal});try{check(signal);this.#check();this.#scans.set(scan.id,scan);return scan;}catch(primary){try{await this.#port.closeScan(scan);}catch(cleanup){this.#fail(cleanup);throw combine([primary,cleanup],'Linked scan admission/retirement failed.');}throw primary;}
 }};});
 readonly nextScan=(value:Scan,options?:Options)=>this.#run(()=>{const request=signalOptions(options??{}),scan=this.#scan(value);return{signal:request.signal,work:async(signal:AbortSignal)=>{const page=await this.#port.nextScan(scan,{signal});check(signal);this.#check();return page;}};});
 readonly closeScan=(value:Scan):Promise<void>=>this.#run(()=>{const scan=handle(value,'linked-scan');return{work:async()=>{if(!this.#scans.has(scan.id))return;try{await this.#port.closeScan(scan);this.#scans.delete(scan.id);}catch(error){this.#fail(error);throw error;}}};},true);
 readonly listDevelopPresets=(options?:Options)=>this.#run(()=>{const request=signalOptions(options??{}),develop=this.#bound().develop;return{signal:request.signal,work:async(signal:AbortSignal)=>{const value=await develop.listPresets({signal});check(signal);this.#check();return value;}};});
 readonly importEntries=(value:unknown,options:ImportOptions={}):Promise<readonly Item[]>=>this.#import(value,options,false);
 readonly importEntriesWithDevelop=(value:unknown,request:DevelopRequest):Promise<readonly Item[]>=>this.#import(value,request,true);
 #import(value:unknown,options:Request,develop:boolean):Promise<readonly Item[]>{
  const gesture={};const accepted=this.#run(()=>{if(this.#importing)throw new Error('A linked import gesture is already active.');this.#importing=gesture;
   const preparedDevelop=develop?developRequest(options):undefined,request=preparedDevelop??importOptions(options),selection=this.#selection(value),bound=this.#bound();if(request.settings?.rename&&request.settings.rename.sequenceStart>Number.MAX_SAFE_INTEGER-selection.entryIds.length+1)throw new RangeError('Linked rename sequence exceeds its safe integer bound.');return{signal:request.signal,work:async(signal:AbortSignal)=>{
    const result:Item[]=[];let total=0;await bound.readPage({signal});check(signal);this.#check();
     for(const[index,entryId]of selection.entryIds.entries()){
      check(signal);this.#check();const receipt=await this.#port.openInput(selection.scan,entryId,{signal});let lease:Lease|undefined,failed=false,primary:unknown;
      try{total+=receipt.facts.byteLength;if(total>IMAGE_IMPORT_LIMITS.maximumGestureInputBytes)throw new RangeError('Linked gesture exceeds the actual image import byte bound.');
       lease=await this.#source.acquire(receipt,{signal});check(signal);this.#check();const selected=Object.freeze({receipt,lease});this.#files.set(lease.body,selected);this.#inputs.set(receipt.facts.sourceId,selected);
       const settings=request.settings===undefined?undefined:normalizePhotoImportSettingsV1({...request.settings,rename:request.settings.rename===null?null:{...request.settings.rename,sequenceStart:request.settings.rename.sequenceStart+index}});
       const local:ImportOptions={signal,...settings?{settings}:{},onAcknowledged:item=>{request.onAcknowledged?.(Object.freeze({...item,index}));}};
       const items=preparedDevelop?await bound.develop.importFiles([lease.body],{...local,schemaVersion:3,developPreset:preparedDevelop.developPreset}):await bound.importFiles([lease.body],local);
       result.push(...items.map(item=>Object.freeze({...item,index})));
      }catch(error){failed=true;primary=error;}
      this.#inputs.delete(receipt.facts.sourceId);if(lease)this.#files.delete(lease.body);
      try{if(lease)await lease.close();else await this.#port.closeInput(receipt.handle);}catch(cleanup){this.#fail(cleanup);throw combine([...(failed?[primary]:[]),cleanup],'Linked Current import and actual input retirement failed.');}if(failed)throw primary;
     }return Object.freeze(result);
   }};
  });return accepted.finally(()=>{if(this.#importing===gesture)this.#importing=undefined;});
 }
 /** Fixed selected media capability. Main independently consumes its genuine
  * native input and publishes the exact staged Root1 in the real LSCP4 DB. */
 readonly stageLinkedOriginalCurrentV1=(value:PhotoDocumentCurrentV1,importId:string,options?:Options):Promise<Publication>=>this.#run(()=>{
  const request=signalOptions(options??{}),document=currentPhoto(value),selected=this.#inputs.get(document.original.storageKey);if(!selected)throw new Error('Linked publication has no owned selected input.');
  const facts=selected.receipt.facts;if(document.original.retention!=='linked'||document.original.contentSha256!==facts.contentSha256||document.original.byteLength!==facts.byteLength||document.original.name!==facts.displayName)throw new Error('Linked publication differs from its actual source facts.');
  return{signal:request.signal,work:(signal:AbortSignal)=>this.#port.publishInput(selected.receipt.handle,importId,document,{signal})};
 });
 readonly prepare=(value:unknown):AsyncIterable<Outcome>=>{
  this.#check();const r=record(value,'linked Current preparation',['files','ownership','catalog','createdAt','folderId','signal'],['files','ownership','catalog','createdAt']),files=array(field(r,'files','linked Current preparation'),'linked preparation files',1,IMAGE_IMPORT_LIMITS.maximumFilesPerGesture);
  const selected=files.length===1?this.#files.get(files[0] as File):undefined;if(!selected&&files.some(file=>this.#files.has(file as File)))throw new Error('A private linked File cannot enter a mixed unowned preparation gesture.');
  const raw=selected?this.#port.rawImport?.(selected.receipt.handle):this.#fallback;return this.#prepare(preparing(value,raw?{rawImport:raw}:{}),selected);
 };
 async *#prepare(values:AsyncIterable<Outcome>,selected:Bound|undefined):AsyncGenerator<Outcome>{
  for await(const outcome of values){this.#check();if(!selected||outcome.outcome==='failed'){yield outcome;continue;}
   const facts=selected.receipt.facts;if(outcome.original.size!==facts.byteLength||outcome.photo.original.contentSha256!==facts.contentSha256||outcome.photo.original.name!==facts.displayName)throw new Error('Actual Current decoder input differs from its linked native source.');
   yield Object.freeze({...outcome,photo:photo({...outcome.photo,original:{...outcome.photo.original,storageKey:facts.sourceId,retention:'linked'},metadata:{...outcome.photo.metadata,modifiedTime:null}})});
  }
 }
 #bound(){if(!this.#session||!this.#sessionImport||!this.#readPage||!this.#develop)throw new Error('Linked library has no actual Current Session.');return{session:this.#session,importFiles:this.#sessionImport,readPage:this.#readPage,develop:this.#develop};}
 #selection(value:unknown):Selection{const r=record(value,'linked entry selection',['scan','entryIds']),scan=this.#scan(field(r,'scan','linked entry selection')),entryIds=Object.freeze(array(field(r,'entryIds','linked entry selection'),'linked import entries',1,IMAGE_IMPORT_LIMITS.maximumFilesPerGesture).map(token));if(new Set(entryIds).size!==entryIds.length)throw new Error('Linked gesture repeats a scan entry.');return Object.freeze({scan,entryIds});}
 #scan(value:unknown):Scan{const selected=handle(value,'linked-scan'),actual=this.#scans.get(selected.id);if(!actual)throw new Error('Linked scan belongs to another local owner.');return actual;}
 #run<Result>(capture:()=>Readonly<{signal?:AbortSignal;work(signal:AbortSignal):Promise<Result>}>,cleanup=false):Promise<Result>{
  try{if(!cleanup)this.#check();}catch(error){return Promise.reject(error);}let resolve!:(value:Result)=>void,reject!:(reason:unknown)=>void;
  const promise=new Promise<Result>((yes,no)=>{resolve=yes;reject=no;}),controller=new Controller(),entry:Work={controller,promise};this.#pending.add(entry);let detach:()=>void=()=>undefined;
  const complete=():unknown[]=>{const failures:unknown[]=[];try{detach();}catch(error){failures.push(error);this.#fail(error);}this.#pending.delete(entry);return failures;};
  try{const selected=capture(),caller=selected.signal;const forward=()=>{if(caller&&!controller.signal.aborted)Reflect.apply(ABORT,controller,[Reflect.apply(REASON,caller,[])]);};if(caller){Reflect.apply(ADD,caller,['abort',forward,{once:true}]);detach=()=>{Reflect.apply(REMOVE,caller,['abort',forward]);};if(caller.aborted)forward();}
   if(!cleanup){check(controller.signal);this.#check();}let actual:Promise<Result>;try{actual=selected.work(controller.signal);}catch(error){actual=Promise.reject(error);}
   void actual.then(value=>{const errors=complete();if(errors.length)reject(combine(errors,'Linked operation retirement failed.'));else resolve(value);},(primary:unknown)=>{const errors=complete();reject(errors.length?combine([primary,...errors],'Linked operation and retirement failed.'):primary);});
  }catch(primary){const errors=complete();reject(errors.length?combine([primary,...errors],'Linked admission and retirement failed.'):primary);}return promise;
 }
 #check():void{check(this.#parent);if(this.#stopped||this.#cleanup.length)throw new DOMException('The linked library is retiring or quarantined.','AbortError');}
 #fail(error:unknown):void{if(!this.#cleanup.some(value=>Object.is(value,error)))this.#cleanup.push(error);this.#stop();}
 #stop():void{if(this.#stopped)return;this.#stopped=true;const reason=this.#parent.aborted?Reflect.apply(REASON,this.#parent,[]):new DOMException('Linked library closed.','AbortError');for(const entry of this.#pending)if(!entry.controller.signal.aborted)try{Reflect.apply(ABORT,entry.controller,[reason]);}catch(error){this.#cleanup.push(error);}try{this.#sourceClosing=this.#source.close();}catch(error){this.#sourceClosing=Promise.reject(error);}void this.#sourceClosing.catch(()=>undefined);}
 close():Promise<void>{
  if(this.#closing)return this.#closing;let resolve!:()=>void,reject!:(reason:unknown)=>void;this.#closing=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});this.#stop();
  void(async()=>{const errors:unknown[]=[];while(this.#pending.size)await Promise.allSettled([...this.#pending].map(entry=>entry.promise));for(const scan of this.#scans.values())try{await this.#port.closeScan(scan);this.#scans.delete(scan.id);}catch(error){errors.push(error);}
   try{await this.#sourceClosing;}catch(error){errors.push(error);}try{this.#detach();}catch(error){errors.push(error);}for(const error of this.#cleanup)if(!errors.some(value=>Object.is(value,error)))errors.push(error);if(errors.length)throw combine(errors,'Linked Current local consumers did not retire.');
  })().then(resolve,reject);return this.#closing;
 }
}
function check(signal:AbortSignal):void{Reflect.apply(CHECK,signal,[]);}
function combine(values:readonly unknown[],message:string):unknown{const errors:unknown[]=[];for(const value of values)if(!errors.some(error=>Object.is(error,value)))errors.push(value);return errors.length===1?errors[0]:new AggregateError(errors,message,{cause:errors[0]});}
