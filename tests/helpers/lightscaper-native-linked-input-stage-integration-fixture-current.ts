/* SPDX-License-Identifier: AGPL-3.0-only */
import type { TestContext } from 'node:test';
import { DesktopPhotoLinkedInputSourceCurrentV1 as Source } from '../../src/lightscaper/desktop-photo-linked-input-stage-current-v1.ts';
import { originalGroupFixtureCurrentV1 as opfs } from './lightscaper-desktop-original-group-fixture-current.ts';
import { linkedSessionFixtureCurrentV1 as native } from './lightscaper-native-linked-session-integration-fixture-current.ts';
export { hash,options,GRANTED_FS_OP,remainsPending,CATALOG,photo } from './lightscaper-native-linked-session-integration-fixture-current.ts';
export async function linkedInputStageFixtureCurrentV1(context:TestContext,run:(f:Awaited<ReturnType<typeof create>>)=>Promise<void>):Promise<void>{
 await native(context,async actual=>{const storage=opfs(context),f=await create(actual,storage);let failed=false,primary:unknown;
  try{await run(f);}catch(error){failed=true;primary=error;}const failures:unknown[]=[];
  try{await f.closeStage();}catch(error){failures.push(error);}try{await storage.close();}catch(error){failures.push(error);}
  if(failures.length)throw new AggregateError([...(failed?[primary]:[]),...failures],'Actual linked stage work did not retire.',{cause:failures[0]});if(failed)throw primary;
 });
}
type Native=Parameters<Parameters<typeof native>[1]>[0];
async function create(actual:Native,storage:ReturnType<typeof opfs>){
 let number=0,closing:Promise<void>|undefined;
 const hooks={read:async()=>undefined};
 const transport={read:async(handle:Readonly<{kind:'linked-input';id:string}>,offset:number,length:number):Promise<unknown>=>{await hooks.read();return actual.run({operation:'input-read',handle,offset,length});},close:(handle:Readonly<{kind:'linked-input';id:string}>)=>actual.run({operation:'input-close',handle}).then(()=>undefined)};
 const source=new Source(transport,{storage:storage.storage,createId:()=>`00000000-0000-4000-8000-${String(++number).padStart(12,'0')}`});
 const leases=new Set<Readonly<{close():Promise<void>}>>(),work=new Set<Promise<unknown>>();
 const track=<Value>(accepted:Promise<Value>):Promise<Value>=>{work.add(accepted);void accepted.then(value=>{if(value&&typeof value==='object'&&'body'in value&&value.body instanceof File&&'close'in value&&typeof value.close==='function'){const close=value.close;leases.add(Object.freeze({close:()=>Reflect.apply(close,value,[]) as Promise<void>}));}work.delete(accepted);},()=>{work.delete(accepted);});return actual.track(accepted);};
 return{...actual,source,opfs:storage,transport,hooks,track,
  async acquire(name='Selected native.DNG'){const input=await actual.open(name),lease=await track(source.acquire(input));leases.add(lease);return{input,lease};},
  closeStage():Promise<void>{closing??=Promise.resolve().then(async()=>{actual.release();storage.stop.abort(new Error('Actual stage fixture retiring.'));const sourceClosing=source.close();void sourceClosing.catch(()=>undefined);await Promise.allSettled([...work]);const results=await Promise.allSettled([...leases].map(value=>value.close()));let failure:unknown;
   try{await sourceClosing;}catch(error){failure=error;}const errors=results.flatMap(value=>value.status==='rejected'?[value.reason as unknown]:[]);if(failure!==undefined)errors.push(failure);if(errors.length)throw new AggregateError(errors,'Actual native input stages did not retire.',{cause:errors[0]});});return closing;},
 };
}
