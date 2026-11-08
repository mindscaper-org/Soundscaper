/* SPDX-License-Identifier: AGPL-3.0-only */
import {randomBytes} from 'node:crypto';
import {readClosedDomainRecord as record,readClosedDomainField as field} from '../src/common/foundation/closed-domain-value.ts';
import {id,name} from '../src/lightscaper/catalog/value-validation.ts';
import {normalizePhotoDocumentCurrentV1 as photo,type PhotoDocumentCurrentV1} from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import {readDesktopPhotoLinkedPacketCurrentV1 as packet} from '../src/lightscaper/desktop-photo-linked-contract-current-v1.ts';
import {deriveLightscaperNativePhotoOriginalPathsCurrentV1} from './lightscaper-native-original-index-current-v1.ts';
import {captureLightscaperNativePhotoGrantedFilesystemCurrentV1 as filesystem,type LightscaperNativePhotoGrantedFilesystemCurrentV1 as Filesystem,type NativePath} from './lightscaper-native-photo-granted-filesystem-current-v1.ts';
import {captureComponents} from './lightscaper-native-photo-granted-filesystem-codec-current-v1.ts';
import {captureLightscaperNativePhotoLinkedGrantsCurrentV1 as captureGrants,type LightscaperNativePhotoLinkedGrantsCurrentV1 as Grants} from './lightscaper-native-photo-linked-grants-current-v1.ts';
import {captureLightscaperNativePhotoLinkedOriginalsCurrentV1 as captureLinked,type LightscaperNativePhotoLinkedOriginalsCurrentV1 as Linked} from './lightscaper-native-photo-linked-originals-current-v1.ts';
import {withLightscaperNativePhotoLinkedInputCurrentV1 as borrow,type LightscaperNativePhotoLinkedInputCurrentV1 as Input,type LightscaperNativePhotoLinkedInputViewCurrentV1 as View} from './lightscaper-native-photo-linked-input-current-v1.ts';
import {LightscaperNativePhotoSessionHandlesCurrentV1 as Handles} from './lightscaper-native-photo-session-handles-current-v1.ts';
import {LinkedGrantLifetimeCurrentV1 as Lifetime,captureLinkedGrantSignalCurrentV1 as signal,type LinkedGrantOperationCurrentV1 as Work} from './lightscaper-native-photo-linked-grants-lifetime-current-v1.ts';
import {createLinkedGrantCleanupFailureCurrentV1 as cleanup,combineLinkedGrantFailuresCurrentV1 as combine} from './lightscaper-native-photo-linked-grants-failures-current-v1.ts';
import {captureLightscaperNativeCatalogReadCurrentV1 as captureCatalog,type LightscaperNativeCatalogReadCurrentV1 as CatalogRead} from './lightscaper-native-catalog-store-current-v1.ts';
import {readLightscaperNativePhotoLinkedInspectionPageCurrentV1 as inspectionPage} from './lightscaper-native-photo-linked-inspection-page-current-v1.ts';
type Handle=Readonly<{kind:'linked-input'|'linked-scan';id:string}>;type Options=Readonly<{signal?:AbortSignal}>;
type Scope=Readonly<{signal:AbortSignal;assertCurrent():void}>;
type Opening=Readonly<{namespace:string;catalogId:string;grants:Grants;linked:Linked;facet:ReturnType<typeof captureGrants>;handles:Handles;catalog?:CatalogRead;scope:Scope;notify():void}>;
type Scan=Awaited<ReturnType<Opening['facet']['openScan']>>;
type Common={readonly handle:Handle;readonly owner:Readonly<{close():Promise<void>}>};
type ScanState=Common&{readonly kind:'linked-scan';readonly grantId:string;readonly components:readonly NativePath[];readonly scan:Scan;readonly entries:Set<string>;busy:boolean};
type InputState=Common&{readonly kind:'linked-input';readonly input:Readonly<Input>};
type State=ScanState|InputState;
type Entry=Readonly<{scan:ScanState;components:readonly NativePath[];kind:string;displayName:string;byteLength:number|null}>;
/** Trusted Main adapter for the authenticated selected Session. Every handle
 * is still resolved against the actual existing connection registry. */
export class LightscaperNativePhotoLinkedSessionCurrentV1{
 readonly #opening:Opening;readonly #life:Lifetime;readonly #states=new Map<object,State>();readonly #entries=new Map<string,Entry>();readonly #dispatches=new Set<Promise<unknown>>();#closing:Promise<void>|undefined;
 private constructor(opening:Opening){this.#opening=opening;this.#life=new Lifetime(opening.scope.signal,opening.notify,this);}
 static create(value:Readonly<{appDataPath:string;catalogId:string;grants:Grants;originals:Linked;filesystem:Filesystem;handles:Handles;catalog?:CatalogRead;scope:Scope;unretired():void}>):LightscaperNativePhotoLinkedSessionCurrentV1{return new LightscaperNativePhotoLinkedSessionCurrentV1(capture(value));}
 #check(work?:Work):void{this.#life.check(work);this.#opening.scope.assertCurrent();this.#life.check(work);}
 execute(value:unknown,caller?:AbortSignal):Promise<unknown>{
  let resolve!:(value:unknown)=>void,reject!:(reason:unknown)=>void;const pending=new Promise<unknown>((yes,no)=>{resolve=yes;reject=no;});this.#dispatches.add(pending);
  let accepted:Promise<unknown>;try{accepted=this.#execute(value,caller);}catch(error){accepted=Promise.reject(error);}void accepted.then(value=>{this.#dispatches.delete(pending);resolve(value);},(error:unknown)=>{this.#dispatches.delete(pending);reject(error);});return pending;
 }
 #execute(value:unknown,caller?:AbortSignal):Promise<unknown>{
  const op=value!==null&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,'operation')?.value as unknown:undefined;
  if(op==='input-close'||op==='scan-close'){try{const p=packet(value,this.#opening.catalogId);return this.#opening.handles.close(p.handle,op==='input-close'?'linked-input':'linked-scan');}catch(error){return Promise.reject(error);}}
  let unreturned:Handle|undefined,bytes:Uint8Array|undefined;
  const accepted=this.#life.run(false,caller===undefined?undefined:{signal:caller},()=>{this.#check();return packet(value,this.#opening.catalogId);},async(p,work)=>{
   this.#check(work);switch(p.operation){
    case'available':return true;
    case'choose-folder':{const result=await this.#opening.grants.authorize({signal:work.signal});if(result!==null)work.acknowledged=true;return result;}
    case'inspect-page':{if(!this.#opening.catalog)throw new Error('Linked inspection has no genuine bound Catalog.');return inspectionPage(this.#opening.catalog,this.#opening.linked,this.#opening.catalogId,p.cursor as string|null,work.signal);}
    case'inspect-original':return this.#opening.linked.inspect(p.binding as Parameters<Linked['inspect']>[0],{signal:work.signal});
    case'grants':return this.#opening.grants.readPage(p.afterGrantId as string|null,{signal:work.signal});
    case'scan-open':{const result=await this.#openScan(p,work);unreturned=result.handle;return result;}
    case'scan-next':return this.#next(this.#scan(p.handle),work);
    case'input-open':{const result=await this.#openInput(p,work);unreturned=result.handle;return result;}
    case'input-read':{const selected=this.#input(p.handle);bytes=await borrow(selected.input,this.#opening.namespace,view=>view.read(p.offset as number,p.length as number),{signal:work.signal});this.#check(work);return bytes;}
    case'publish-input':{const selected=this.#input(p.handle),document=photo(p.photo);this.#match(selected,document);const facts=selected.input.facts;
     await this.#opening.linked.publishInput(selected.input,{catalogId:this.#opening.catalogId,importId:p.importId as string,photoId:document.id,original:document.original,metadata:{name:document.original.name,mimeType:document.original.mimeType}},{signal:work.signal});work.acknowledged=true;
     return Object.freeze({sourceId:facts.sourceId,sha256:facts.contentSha256,size:facts.byteLength});}
    case'relink-input':{const selected=this.#input(p.handle),result=await this.#opening.linked.relink(p.binding as Parameters<Linked['relink']>[0],selected.input,p.expectedRevision as number,{signal:work.signal});work.acknowledged=true;return result;}
    case'revoke':{const result=await this.#opening.grants.revoke(p.grantId as string,{signal:work.signal});if(result)work.acknowledged=true;return result;}
   }throw new TypeError('Unknown fixed linked operation.');
  });
  return accepted.then(result=>{unreturned=undefined;return result;},async(primary:unknown)=>{bytes?.fill(0);if(unreturned){try{await this.#opening.handles.close(unreturned,unreturned.kind);}catch(error){throw combine([primary,error],'Unpublished linked handle retirement failed.');}}throw primary;});
 }
 withInput<Result>(handle:unknown,consume:(view:Readonly<View>)=>Result|PromiseLike<Result>,options?:Options):Promise<Result>{return this.#life.run(false,options,()=>{this.#check();const selected=this.#input(handle);if(typeof consume!=='function')throw new TypeError('Native linked input needs its actual consumer.');return selected;},(selected,work)=>borrow(selected.input,this.#opening.namespace,consume,{signal:work.signal}));}
 #scan(value:unknown):ScanState{const owner=this.#opening.handles.owner(value,'linked-scan'),state=this.#states.get(owner);if(!state||state.kind!=='linked-scan')throw new Error('Linked scan belongs to another owner.');state.scan.assertCurrent();return state;}
 #input(value:unknown):InputState{const owner=this.#opening.handles.owner(value,'linked-input'),state=this.#states.get(owner);if(!state||state.kind!=='linked-input')throw new Error('Linked input belongs to another owner.');return state;}
 #entry(id:string):Entry{const selected=this.#entries.get(id);if(!selected)throw new Error('Native scan entry has expired.');selected.scan.scan.assertCurrent();return selected;}
 #clear(state:ScanState):void{for(const key of state.entries)this.#entries.delete(key);state.entries.clear();}
 #own(kind:'linked-input',handle:Handle,input:Readonly<Input>,grantId?:undefined,components?:undefined):InputState;
 #own(kind:'linked-scan',handle:Handle,scan:Scan,grantId:string,components:readonly NativePath[]):ScanState;
 #own(kind:'linked-input'|'linked-scan',handle:Handle,native:Readonly<Input>|Scan,grantId?:string,components?:readonly NativePath[]):State{
  let closing:Promise<void>|undefined;const owner:Readonly<{close():Promise<void>}>=Object.freeze({close:():Promise<void>=>{if(closing)return closing;closing=Promise.resolve().then(async()=>{
   if(state.kind==='linked-scan')this.#clear(state);try{await native.close();}catch(error){const failure=cleanup([error],'Native linked Session handle retirement failed.');this.#life.fail(failure);throw failure;}this.#states.delete(owner);
  });return closing;}});
  const state:State=kind==='linked-input'?{kind,handle,owner,input:native as Readonly<Input>}:{kind,handle,owner,grantId:grantId!,components:components!,scan:native as Scan,entries:new Set(),busy:false};this.#states.set(owner,state);return state;
 }
 async #openScan(p:Readonly<Record<string,unknown>>,work:Work):Promise<Readonly<{handle:Handle}>>{
  const grantId=p.grantId as string;let components:readonly NativePath[]=Object.freeze([]);
  if(p.entryId!==undefined){const entry=this.#entry(p.entryId as string);if(entry.scan.grantId!==grantId||entry.kind!=='directory')throw new Error('Native directory capability belongs to another current grant.');components=captureComponents(entry.components,true);}
  const booking=this.#opening.handles.reserve('linked-scan');let scan:Scan|undefined;
  try{const captured=this.#opening.facet.captureScan(grantId,components);this.#check(work);scan=await this.#opening.facet.openScan(captured);this.#check(work);const state=this.#own('linked-scan',booking.handle,scan,grantId,components);booking.publish(state.owner);return Object.freeze({handle:booking.handle});}
  catch(primary){try{await scan?.close();}catch(error){const owner=Object.freeze({close:()=>scan!.close()});booking.quarantine(owner);const failure=cleanup([primary,error],'Undelivered native scan retirement failed.');this.#life.fail(failure);throw failure;}booking.abandon();throw primary;}
 }
 async #next(state:ScanState,work:Work):Promise<Readonly<{entries:readonly Readonly<{entryId:string;displayName:string;kind:string;byteLength:number|null}>[];done:boolean}>>{
  if(state.busy)throw new Error('Native scan is busy.');state.busy=true;this.#clear(state);
  try{const page=await state.scan.next();this.#check(work);state.scan.assertCurrent();const entries=page.entries.map(value=>{
   const components=captureComponents([...state.components,value.component],false),displayName=Buffer.from(value.component.bytes).toString(value.component.encoding==='posix-bytes'?'utf8':'utf16le');let entryId:string;do{entryId=randomBytes(32).toString('hex');}while(this.#entries.has(entryId));
   this.#entries.set(entryId,Object.freeze({scan:state,components,kind:value.kind,displayName,byteLength:value.byteLength}));state.entries.add(entryId);return Object.freeze({entryId,displayName,kind:value.kind,byteLength:value.byteLength});
  });return Object.freeze({entries:Object.freeze(entries),done:page.done});}finally{state.busy=false;}
 }
 async #openInput(p:Readonly<Record<string,unknown>>,work:Work){
  const state=this.#scan(p.scan),entry=this.#entry(p.entryId as string);if(entry.scan!==state||entry.kind!=='file')throw new Error('Only an actual current regular file scan entry can be imported.');name(entry.displayName,'linked filename');
  const booking=this.#opening.handles.reserve('linked-input');let input:Readonly<Input>|undefined;
  try{input=await this.#opening.linked.prepareInput(state.grantId,entry.components,{signal:work.signal});this.#check(work);const selected=this.#own('linked-input',booking.handle,input);booking.publish(selected.owner);return Object.freeze({handle:booking.handle,facts:input.facts});}
  catch(primary){try{await input?.close();}catch(error){const owner=Object.freeze({close:()=>input!.close()});booking.quarantine(owner);const failure=cleanup([primary,error],'Undelivered linked input retirement failed.');this.#life.fail(failure);throw failure;}booking.abandon();throw primary;}
 }
 #match(selected:InputState,document:PhotoDocumentCurrentV1):void{const facts=selected.input.facts,o=document.original;if(document.catalogId!==this.#opening.catalogId||o.retention!=='linked'||o.storageKey!==facts.sourceId||o.contentSha256!==facts.contentSha256||o.byteLength!==facts.byteLength||o.name!==facts.displayName)throw new Error('Linked Photo differs from its actual selected native input.');}
 close():Promise<void>{this.#closing??=this.#life.close(async()=>{await Promise.allSettled([...this.#dispatches]);const results=await Promise.allSettled([...this.#states.values()].map(state=>this.#opening.handles.close(state.handle,state.kind)));const errors=results.flatMap(value=>value.status==='rejected'?[value.reason as unknown]:[]);if(errors.length)throw combine(errors,'Native linked Session did not retire.');});return this.#closing;}
}
function own(value:unknown,key:string):unknown{if(value===null||typeof value!=='object')throw new TypeError('Native linked Session requires own options.');const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!Object.hasOwn(descriptor,'value'))throw new TypeError('Native linked Session requires inert own options.');return descriptor.value;}
function capture(value:unknown):Opening{
 const appDataPath=own(value,'appDataPath');if(typeof appDataPath!=='string')throw new TypeError('Native linked Session needs its private appData.');const namespace=deriveLightscaperNativePhotoOriginalPathsCurrentV1(appDataPath).databasePath;
 const grants=own(value,'grants') as Grants,linked=own(value,'originals') as Linked;const facet=captureGrants(grants,namespace);captureLinked(linked,namespace);filesystem(own(value,'filesystem'),namespace);
 const r=record(value,'native linked Session',['appDataPath','catalogId','grants','originals','filesystem','handles','scope','unretired','catalog'],['appDataPath','catalogId','grants','originals','filesystem','handles','scope','unretired']),scoped=field(r,'scope','native linked Session'),s=record(scoped,'linked Session scope',['signal','assertCurrent']),assert=field(s,'assertCurrent','linked Session scope'),notify=field(r,'unretired','native linked Session'),handles=field(r,'handles','native linked Session');
 if(typeof assert!=='function'||typeof notify!=='function'||!(handles instanceof Handles))throw new TypeError('Native linked Session ownership is incomplete.');const selected=signal(field(s,'signal','linked Session scope'));
 const catalog=Object.hasOwn(r,'catalog')?captureCatalog(field(r,'catalog','native linked Session'),namespace):undefined;
 return Object.freeze({namespace,catalogId:id(field(r,'catalogId','native linked Session'),'linked catalog'),grants,linked,facet,handles,...(catalog?{catalog}:{}),scope:Object.freeze({signal:selected,assertCurrent:()=>{Reflect.apply(assert,scoped,[]);}}),notify:()=>{Reflect.apply(notify,value,[]);}});
}
