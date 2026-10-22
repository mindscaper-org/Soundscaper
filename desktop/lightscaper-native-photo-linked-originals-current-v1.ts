/* SPDX-License-Identifier: AGPL-3.0-only */
import {createHash,randomBytes} from 'node:crypto';
import {realpathSync} from 'node:fs';
import type {DatabaseSync} from 'node:sqlite';
import {readClosedDomainRecord as record,readClosedDomainField as field} from '../src/common/editor/closed-domain-value.ts';
import {catalogOriginalId} from '../src/common/editor/storage/media-catalog-original-schema.ts';
import {normalizeCatalogOriginalRepairBindingV1,type CatalogOriginalRepairBindingV1} from '../src/common/editor/storage/media-catalog-original-repair-contract.ts';
import {IMAGE_IMPORT_LIMITS} from '../src/common/editor/image-import-admission.ts';
import type {PhotoOriginalV1} from '../src/lightscaper/catalog/types.ts';
import {deriveLightscaperNativePhotoOriginalPathsCurrentV1} from './lightscaper-native-original-index-current-v1.ts';
import {readLightscaperNativePhotoOriginalEnvelopeCurrentV1 as original} from './lightscaper-native-photo-original-envelope-current-v1.ts';
import {captureLightscaperNativePhotoLinkedGrantsCurrentV1 as captureGrants,type LightscaperNativePhotoLinkedGrantsCurrentV1 as Grants} from './lightscaper-native-photo-linked-grants-current-v1.ts';
import type {LinkedGrantFileCurrentV1 as File,LinkedGrantFileCaptureCurrentV1 as FileCapture} from './lightscaper-native-photo-linked-grants-borrows-current-v1.ts';
import {openLightscaperNativePhotoMediaDatabaseCurrentV1 as openDatabase} from './lightscaper-native-photo-media-files-current-v1.ts';
import {LinkedGrantLifetimeCurrentV1 as Lifetime,captureLinkedGrantSignalCurrentV1 as signal,checkLinkedGrantSignalCurrentV1 as check,type LinkedGrantOperationCurrentV1 as Operation} from './lightscaper-native-photo-linked-grants-lifetime-current-v1.ts';
import {createLinkedGrantCleanupFailureCurrentV1 as cleanup,combineLinkedGrantFailuresCurrentV1 as combine,retainLinkedGrantCleanupCurrentV1 as retain} from './lightscaper-native-photo-linked-grants-failures-current-v1.ts';
import {createLinkedInputCurrentV1,readLinkedInputCurrentV1,withLightscaperNativePhotoLinkedInputCurrentV1 as withInput,type LightscaperNativePhotoLinkedInputCurrentV1 as Input} from './lightscaper-native-photo-linked-input-current-v1.ts';
import {captureLightscaperNativePhotoMediaMetadataCurrentV1 as metadata} from './lightscaper-native-photo-media-metadata-current-v1.ts';
import {publishLinkedOriginalCurrentV1 as publish} from './lightscaper-native-photo-linked-publication-current-v1.ts';
import {readLinkedOriginalRowCurrentV1 as readRow,type LinkedOriginalRowCurrentV1 as Row} from './lightscaper-native-photo-linked-records-current-v1.ts';
import {encodeLinkedLocatorCurrentV1,equalLinkedIdentityCurrentV1 as sameIdentity} from './lightscaper-native-photo-linked-locator-current-v1.ts';
import {readLightscaperNativePhotoMediaIdentityCurrentV1 as identity} from './lightscaper-native-photo-media-identity-current-v1.ts';
import {readLightscaperNativePhotoLinkedCustodyCurrentV1 as custody} from './lightscaper-native-photo-original-inspection-custody-current-v1.ts';
import type {NativePath} from './lightscaper-native-photo-granted-filesystem-current-v1.ts';

import {readLightscaperNativePhotoLinkedUnavailableCurrentV1 as unavailable} from './lightscaper-native-photo-linked-unavailable-current-v1.ts';
import type {DesktopPhotoLinkedInspectionCurrentV1 as Inspection} from '../src/lightscaper/desktop-photo-linked-management-contract-current-v1.ts';
type Options=Readonly<{signal?:AbortSignal}>;
type Scope=Readonly<{signal:AbortSignal;assertCurrent():void}>;
type Opening=Readonly<{appDataPath:string;path:string;grants:ReturnType<typeof captureGrants>;scope:Scope;notify():void}>;
type Binding=Readonly<{storageKey:string;contentSha256:string;byteLength:number}>;
type Captured=Readonly<{row:Row;file:FileCapture}>;
type Physical=Readonly<{read(offset:number,length:number,options?:Options):Promise<Uint8Array>;close():Promise<void>}>;
type Facet=Readonly<{assertCurrent():void;captureRead(binding:Binding):Captured;acquireRead(value:Captured,options?:Options):Promise<Physical>;verifyOriginal(value:Readonly<PhotoOriginalV1>,signal?:AbortSignal):Promise<void>}>;
const OWNERS=new WeakMap<object,Readonly<{namespace:string;facet:Facet}>>();
const canonical=(path:string):string=>{const value=realpathSync(path);return process.platform==='win32'?value.toLowerCase():value;};
export function captureLightscaperNativePhotoLinkedOriginalsCurrentV1(value:unknown,mediaDatabasePath:string):Facet{
	const owner=value!==null&&typeof value==='object'?OWNERS.get(value):undefined;
	if(!owner||owner.namespace!==canonical(mediaDatabasePath))throw new TypeError('A genuine same-namespace linked Original owner is required.');owner.facet.assertCurrent();return owner.facet;
}
/** Main-only genuine native source and LSCP4 publication owner. No path, grant,
 * locator record or digest descriptor independently authorizes a Photo body. */
export class LightscaperNativePhotoLinkedOriginalsCurrentV1{
	readonly #opening:Opening;readonly #db:DatabaseSync;readonly #life:Lifetime;readonly #inputs=new Set<Input>();
	readonly #captures=new WeakSet<object>();readonly #leases=new Set<Promise<void>>();
	private constructor(db:DatabaseSync,opening:Opening){
		this.#db=db;this.#opening=opening;this.#life=new Lifetime(opening.scope.signal,opening.notify,this);
		OWNERS.set(this,Object.freeze({namespace:canonical(opening.path),facet:Object.freeze<Facet>({assertCurrent:()=>{this.#check();},captureRead:binding=>this.#captureRead(binding),acquireRead:(value,options)=>this.#acquireRead(value,options),verifyOriginal:(value,caller)=>this.#verifyOriginal(value,caller)})}));Object.freeze(this);
	}
	static async open(options:Readonly<{appDataPath:string;grants:Grants;scope:Scope;unretired():void}>):Promise<LightscaperNativePhotoLinkedOriginalsCurrentV1>{
		const opening=captureOpening(options);opening.scope.assertCurrent();check(opening.scope.signal);let db:DatabaseSync|undefined;
		try{db=await openDatabase(opening.appDataPath);opening.scope.assertCurrent();check(opening.scope.signal);return new LightscaperNativePhotoLinkedOriginalsCurrentV1(db,opening);}
		catch(primary){try{db?.close();}catch(error){retain({db,opening});const failures:unknown[]=[primary,error];try{opening.notify();}catch(notice){failures.push(notice);}throw cleanup(failures,'Linked Original opening and database close failed.');}throw primary;}
	}
	#check(entry?:Operation):void{this.#life.check(entry);this.#opening.scope.assertCurrent();this.#life.check(entry);}
	readonly prepareInput=(grantId:string,components:readonly NativePath[],options?:Options):Promise<Readonly<Input>>=>this.#life.run(false,options,()=>{
		this.#check();return this.#opening.grants.capture(grantId,components);
	},async(captured,entry)=>{
		let file:File|undefined;
		try{this.#check(entry);file=await this.#opening.grants.open(captured);this.#check(entry);
			if(file.byteLength<1||file.byteLength>IMAGE_IMPORT_LIMITS.maximumFileInputBytes)throw new RangeError('Linked import file exceeds the actual input profile.');
			const sha256=await hash(file,entry.signal);this.#check(entry);const last=captured.components.at(-1)!;
			const displayName=Buffer.from(last.bytes).toString(last.encoding==='posix-bytes'?'utf8':'utf16le');
			const input=createLinkedInputCurrentV1(this,this.#opening.path,captured,file,sha256,displayName,()=>{this.#check();},async(state,close)=>{
				try{await close();this.#inputs.delete(state.input);}catch(error){const failure=cleanup([error],'Linked input native file retirement failed.');this.#life.fail(failure);throw failure;}
			});this.#inputs.add(input);file=undefined;return input;
		}catch(primary){try{await file?.close();}catch(error){const failure=cleanup([primary,error],'Linked input admission and native file retirement failed.');this.#life.fail(failure);throw failure;}throw primary;}
	});
	readonly publishInput=(value:unknown,packetValue:Readonly<{catalogId:string;importId:string;photoId:string;original:Readonly<PhotoOriginalV1>;metadata:unknown}>,options?:Options):Promise<Record<string,unknown>>=>this.#life.run(false,options,async()=>{
		const state=readLinkedInputCurrentV1(value,this,this.#opening.path,true),packet=record(packetValue,'linked publication',['catalogId','importId','photoId','original','metadata']);
		const selected=original(field(packet,'original','linked publication')),facts=state.input.facts;
		if(selected.retention!=='linked'||selected.storageKey!==facts.sourceId||selected.contentSha256!==facts.contentSha256||selected.byteLength!==facts.byteLength)throw new Error('Linked publication differs from its actual input.');
		return{state,catalogId:catalogOriginalId(field(packet,'catalogId','linked publication')),importId:catalogOriginalId(field(packet,'importId','linked publication')),photoId:catalogOriginalId(field(packet,'photoId','linked publication')),original:selected,
			metadata:await metadata(facts.sourceId,field(packet,'metadata','linked publication'))};
	},async(input,entry)=>{
		if(await withInput(input.state.input,this.#opening.path,view=>hash(view,entry.signal),{signal:entry.signal})!==input.state.input.facts.contentSha256)throw new Error('Linked input SHA changed before publication.');this.#check(entry);input.state.file.assertCurrent();
		return publish(this.#db,input.state,input,()=>{this.#check(entry);input.state.file.assertCurrent();},()=>{entry.acknowledged=true;});
	});
	readonly relink=(bindingValue:CatalogOriginalRepairBindingV1,value:unknown,expectedRevision:number,options?:Options):Promise<Readonly<{assetId:string;sha256:string;size:number;revision:number}>>=>this.#life.run(false,options,()=>{
		const input=readLinkedInputCurrentV1(value,this,this.#opening.path,true),binding=normalizeCatalogOriginalRepairBindingV1(bindingValue);
		if(!Number.isSafeInteger(expectedRevision)||Object.is(expectedRevision,-0)||expectedRevision<0||expectedRevision===Number.MAX_SAFE_INTEGER)throw new RangeError('Linked relink revision is invalid.');
		if(binding.sha256!==input.input.facts.contentSha256||binding.size!==input.input.facts.byteLength)throw new Error('Relink must preserve the exact Original bytes.');
		return{input,binding,expectedRevision};
	},async({input,binding,expectedRevision},entry)=>{
		const before=version(this.#db),proof=custody(this.#db,binding,entry.signal);if(version(this.#db)!==before||!proof.asset)throw new Error('Linked relink custody changed.');
		const initial=readRow(this.#db,binding.assetId);if(initial.revision!==expectedRevision)throw new Error('Linked relink revision conflict.');
		if(await withInput(input.input,this.#opening.path,view=>hash(view,entry.signal),{signal:entry.signal})!==binding.sha256)throw new Error('Linked relink body SHA differs.');this.#check(entry);
		const locator=encodeLinkedLocatorCurrentV1(input.captured,input.file.identity),locatorId=randomBytes(32).toString('hex');
		this.#db.exec('BEGIN IMMEDIATE');try{
			this.#check(entry);input.file.assertCurrent();if(version(this.#db)!==before)throw new Error('Linked custody changed during relink IO.');
			if(identity(this.#db,{storageKey:binding.assetId,contentSha256:binding.sha256,byteLength:binding.size})!=='linked')throw new Error('Managed media cannot relink.');
			const current=readRow(this.#db,binding.assetId);if(current.revision!==expectedRevision||current.locatorId!==initial.locatorId)throw new Error('Linked relink CAS conflict.');
			const changed=this.#db.prepare('UPDATE native_photo_linked_original_bindings SET grant_id=?,locator_id=?,revision=revision+1,locator=? WHERE storage_key=? AND revision=? AND locator_id=?')
				.run(input.captured.row.grant.grantId,locatorId,locator,binding.assetId,expectedRevision,initial.locatorId);
			const saved=readRow(this.#db,binding.assetId),exact=this.#db.prepare('SELECT locator=? AS same FROM native_photo_linked_original_bindings WHERE storage_key=?').get(locator,binding.assetId);if(exact?.same!==1||changed.changes!==1||saved.revision!==expectedRevision+1||saved.locatorId!==locatorId||saved.grantId!==input.captured.row.grant.grantId)throw new Error('Linked relink was not exact.');
			this.#check(entry);this.#db.exec('COMMIT');entry.acknowledged=true;
		}catch(primary){try{if(this.#db.isTransaction)this.#db.exec('ROLLBACK');}catch(error){throw cleanup([primary,error],'Linked relink rollback failed.');}throw primary;}
		return Object.freeze({assetId:binding.assetId,sha256:binding.sha256,size:binding.size,revision:expectedRevision+1});
	});
 /** Body inspection authenticates its real native file and all retained aliases;
  * only source-owned missing/revoked witnesses become an unavailable outcome. */
 readonly inspect=(bindingValue:CatalogOriginalRepairBindingV1,options?:Options):Promise<Inspection>=>this.#life.run(false,options,()=>normalizeCatalogOriginalRepairBindingV1(bindingValue),async(binding,entry)=>{
  this.#check(entry);const before=version(this.#db),proof=custody(this.#db,binding,entry.signal);if(!proof.asset||version(this.#db)!==before)throw new Error('Linked inspection custody changed.');
  const initial=readRow(this.#db,binding.assetId);let physical:Physical|undefined,reason:ReturnType<typeof unavailable>=null,failed=false,primary:unknown;
  try{physical=await this.#acquireRead(this.#captureRead({storageKey:binding.assetId,contentSha256:binding.sha256,byteLength:binding.size}),{signal:entry.signal});this.#check(entry);}
  catch(error){reason=unavailable(error);if(reason===null){failed=true;primary=error;}}
  try{await physical?.close();}catch(error){throw combine([...(failed?[primary]:[]),error],'Linked inspection and native retirement failed.');}if(failed)throw primary;
  this.#check(entry);const final=custody(this.#db,binding,entry.signal),row=readRow(this.#db,binding.assetId);
  if(version(this.#db)!==before||final.rootsSha256!==proof.rootsSha256||final.count!==proof.count||row.locatorId!==initial.locatorId||row.revision!==initial.revision)throw new Error('Linked inspection changed during native IO.');
  try{this.#captureRead({storageKey:binding.assetId,contentSha256:binding.sha256,byteLength:binding.size});}catch(error){const classified=unavailable(error);if(classified===null)throw error;reason=classified;}
  this.#check(entry);return Object.freeze({locatorRevision:row.revision,grantId:row.grantId,status:reason===null?'present':'unavailable',reason});
 });

	#captureRead(binding:Binding):Captured{
		this.#check();if(this.#db.isTransaction)throw new Error('Linked capture requires an idle actual namespace.');
		if(identity(this.#db,binding)!=='linked')throw new Error('Linked read requires its genuine typed binding.');const row=readRow(this.#db,binding.storageKey);
		const file=this.#opening.grants.capture(row.grantId,row.locator.components);
		if(file.row.grant.revision!==row.locator.revision||!sameIdentity(file.row.identity,row.locator.root))throw new Error('Linked locator no longer matches its actual grant.');
		const captured=Object.freeze({row,file});this.#captures.add(captured);return captured;
	}
	async #acquireRead(value:Captured,options?:Options):Promise<Physical>{
		if(!this.#captures.has(value))throw new TypeError('Linked reader requires its genuine captured locator.');this.#check();
		let resolve!:()=>void,reject!:(reason:unknown)=>void;const done=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});void done.catch(()=>undefined);this.#leases.add(done);
		let file:File|undefined;
		try{const caller=record(options??{},'linked physical options',['signal'],[]),selected=Object.hasOwn(caller,'signal')?signal(field(caller,'signal','linked physical options')):undefined;checkOptional(selected);
			file=await this.#opening.grants.open(value.file);this.#check();checkOptional(selected);
			if(file.byteLength!==value.row.binding.byteLength||!sameIdentity(file.identity,value.row.locator.file))throw new Error('Linked native file was replaced.');
			if(await hash(file,selected)!==value.row.binding.contentSha256)throw new Error('Linked Original SHA no longer matches its immutable binding.');this.#check();
			const actual=file;let closing:Promise<void>|undefined;
			return Object.freeze({read:async(offset:number,length:number,opts?:Options)=>{this.#check();const bytes=await actual.read(offset,length,opts);try{this.#check();return bytes;}catch(error){bytes.fill(0);throw error;}},close:():Promise<void>=>{
				closing??=actual.close().then(()=>{this.#leases.delete(done);resolve();},(error:unknown)=>{const failure=cleanup([error],'Linked reader retirement is unproved.');this.#life.fail(failure);reject(failure);throw failure;});return closing;
			}});
		}catch(primary){try{await file?.close();}catch(error){const failure=cleanup([primary,error],'Linked read opening and retirement failed.');this.#life.fail(failure);reject(failure);throw failure;}this.#leases.delete(done);resolve();throw primary;}
	}
	async #verifyOriginal(value:Readonly<PhotoOriginalV1>,caller?:AbortSignal):Promise<void>{
		const selected=original(value);if(selected.retention!=='linked')throw new Error('Linked verifier cannot admit managed input.');
		const captured=this.#captureRead({storageKey:selected.storageKey,contentSha256:selected.contentSha256!,byteLength:selected.byteLength});
		const file=await this.#acquireRead(captured,caller===undefined?undefined:{signal:caller});let failed=false,primary:unknown;try{checkOptional(caller);this.#check();}catch(error){failed=true;primary=error;}
		try{await file.close();}catch(error){throw combine([...(failed?[primary]:[]),error],'Linked verification and retirement failed.');}if(failed)throw primary;
	}
	readonly close=():Promise<void>=>this.#life.close(async()=>{
		const failures:unknown[]=[];for(const input of this.#inputs){try{await input.close();}catch(error){failures.push(error);}}
		const readers=await Promise.allSettled([...this.#leases]);failures.push(...readers.flatMap(item=>item.status==='rejected'?[item.reason as unknown]:[]));
		if(failures.length)throw combine(failures,'Linked native consumers did not retire.');try{this.#db.close();}catch(error){throw cleanup([error],'Linked media database retirement failed.');}
	});
}
function version(db:DatabaseSync):number{const value=db.prepare('PRAGMA data_version').get()?.data_version;if(typeof value!=='number')throw new Error('Linked namespace version is unavailable.');return value;}
async function hash(file:Readonly<{byteLength:number;read(offset:number,length:number):Promise<Uint8Array>}>,signal?:AbortSignal):Promise<string>{
	const digest=createHash('sha256');for(let offset=0;offset<file.byteLength;offset+=1048576){checkOptional(signal);const bytes=await file.read(offset,Math.min(1048576,file.byteLength-offset));try{checkOptional(signal);digest.update(bytes);}finally{bytes.fill(0);}}checkOptional(signal);return digest.digest('hex');
}
function checkOptional(value?:AbortSignal):void{if(value!==undefined)check(value);}
function own(value:unknown,key:string):unknown{if(value===null||typeof value!=='object')throw new TypeError('Linked owner requires own options.');const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!Object.hasOwn(descriptor,'value'))throw new TypeError('Linked owner requires inert options.');return descriptor.value;}
function captureOpening(value:unknown):Opening{
	const appDataPath=own(value,'appDataPath');if(typeof appDataPath!=='string')throw new TypeError('Linked appData requires a string.');const path=deriveLightscaperNativePhotoOriginalPathsCurrentV1(appDataPath).databasePath;
	const grants=captureGrants(own(value,'grants'),path),options=record(value,'linked Original owner',['appDataPath','grants','scope','unretired']),scopeValue=field(options,'scope','linked Original owner'),scope=record(scopeValue,'linked scope',['signal','assertCurrent']);
	const selected=signal(field(scope,'signal','linked scope')),assert=field(scope,'assertCurrent','linked scope'),notify=field(options,'unretired','linked Original owner');if(typeof assert!=='function'||typeof notify!=='function')throw new TypeError('Linked owner requires trusted scope/retirement capabilities.');
	return Object.freeze({appDataPath,path,grants,scope:Object.freeze({signal:selected,assertCurrent:():void=>{Reflect.apply(assert,scopeValue,[]);}}),notify:():void=>{Reflect.apply(notify,value,[]);}});
}
