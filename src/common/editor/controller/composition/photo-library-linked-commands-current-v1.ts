/* SPDX-License-Identifier: AGPL-3.0-only */
import type {PhotoLibraryOriginalRecoveryPortV1 as Recovery} from '../../photo-library-original-recovery-port-v1.ts';
type ExecutePhotoOriginalRecoveryV1=(run:(context:Readonly<{signal:AbortSignal;acquire():Promise<Recovery>;refresh():Promise<void>;isCurrent():boolean}>)=>Promise<void>)=>Promise<unknown>;
import type {DesktopPhotoLinkedLibraryCurrentV1 as Runtime} from '../../../../lightscaper/desktop-photo-linked-library-current-v1.ts';
import {readCatalogOriginalRepairSignalV1 as signal} from '../../storage/media-catalog-original-repair-contract.ts';
type Registration=Readonly<{execute:ExecutePhotoOriginalRecoveryV1;retire:()=>void}>;
type Active=Readonly<{stop:AbortController;work:Promise<unknown>}>;
/** Presentation borrows the existing complete workflow owner. Neither a menu
 * nor a polling timer opens its own Session or bypasses workspace retirement. */
export class PhotoLibraryLinkedCommandsCurrentV1{
 readonly #resolve:(value:unknown)=>Promise<Runtime|null>;readonly #revoke:(id:string)=>Promise<void>;#registration:Registration|undefined;#active:Active|undefined;
 constructor(options:Readonly<{resolveSession(value:unknown):Promise<Runtime|null>;revoke(grantId:string):Promise<void>}>){const resolve=options.resolveSession,revoke=options.revoke;if(typeof resolve!=='function'||typeof revoke!=='function')throw new TypeError('Linked commands require exact composition owners.');this.#resolve=value=>Reflect.apply(resolve,options,[value]) as Promise<Runtime|null>;this.#revoke=value=>Reflect.apply(revoke,options,[value]) as Promise<void>;}
 register(execute:ExecutePhotoOriginalRecoveryV1,registerRetirement:(close:()=>Promise<void>)=>()=>void):()=>void{
  this.#registration=undefined;if(typeof execute!=='function'||typeof registerRetirement!=='function')throw new TypeError('Linked commands need the complete workflow lifetime.');
  const retire=registerRetirement(()=>this.cancelAndJoin()),entry=Object.freeze({execute,retire});this.#registration=entry;
  return()=>{if(this.#registration===entry)this.#registration=undefined;retire();};
 }
 run<Value>(action:(runtime:Runtime,signal:AbortSignal,refresh:()=>Promise<void>)=>Promise<Value>,options?:Readonly<{signal?:AbortSignal}>):Promise<Value>{
  const registration=this.#registration;if(!registration)return Promise.reject(new DOMException('Linked workflow is closed.','AbortError'));if(this.#active)return Promise.reject(new Error('A linked library command is already pending.'));
  let resolve!:(value:Value)=>void,reject!:(error:unknown)=>void;const work=new Promise<Value>((yes,no)=>{resolve=yes;reject=no;}),stop=new AbortController(),active={stop,work};this.#active=active;
  void(async()=>{const caller=signal(options??{});if(typeof action!=='function')throw new TypeError('Linked workflow command must be callable.');let hasValue=false,value:Value|undefined,failed=false,primary:unknown;
   const status=await registration.execute(async context=>{const combined=AbortSignal.any([stop.signal,context.signal,...caller?[caller]:[]]);combined.throwIfAborted();const session=await context.acquire();combined.throwIfAborted();if(!context.isCurrent())throw new DOMException('Linked workspace has retired.','AbortError');const runtime=await this.#resolve(session);combined.throwIfAborted();if(!runtime)throw new Error('The complete selected Session has no native linked source.');
    try{value=await action(runtime,combined,context.refresh);hasValue=true;}catch(error){failed=true;primary=error;throw error;}
   });if(failed)throw primary;if(!hasValue)throw new Error(status==='busy'?'Photo workspace is busy.':'Linked command did not complete.');return value as Value;
  })().then(resolve,reject);void work.then(()=>{if(this.#active===active)this.#active=undefined;},()=>{if(this.#active===active)this.#active=undefined;});return work;
 }
 revoke(grantId:string):Promise<void>{return this.#revoke(grantId);}
 cancelAndJoin():Promise<void>{const active=this.#active;if(!active)return Promise.resolve();if(!active.stop.signal.aborted)active.stop.abort(new DOMException('Linked command cancelled.','AbortError'));return active.work.then(()=>undefined,()=>undefined);}
}
