/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { LightscaperNativePhotoLinkedSessionCurrentV1 as Session } from '../../desktop/lightscaper-native-photo-linked-session-current-v1.ts';
import { LightscaperNativePhotoSessionHandlesCurrentV1 as Handles } from '../../desktop/lightscaper-native-photo-session-handles-current-v1.ts';
import { linkedOriginalsFixtureCurrentV1 as native, hash, options, GRANTED_FS_OP, remainsPending, CATALOG,
 normalizePhotoDocumentCurrentV1 as photo } from './lightscaper-native-linked-originals-integration-fixture-current.ts';
export { hash, options, GRANTED_FS_OP, remainsPending, CATALOG, photo };
export type Handle = Readonly<{kind:'linked-input'|'linked-scan';id:string}>;
export interface Entry {readonly entryId:string;readonly displayName:string;readonly kind:'file'|'directory'|'link'|'other'|'unknown';readonly byteLength:number|null}
export interface Input {readonly handle:Readonly<{kind:'linked-input';id:string}>;readonly facts:Readonly<{sourceId:string;displayName:string;byteLength:number;contentSha256:string;modifiedTime:null}>}
function row(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object');return value as Record<string,unknown>;}
export function handle<Kind extends Handle['kind']>(value:unknown,kind:Kind):Readonly<{kind:Kind;id:string}>{const r=row(value);assert.deepEqual(Object.keys(r).sort(),['id','kind']);assert.equal(r.kind,kind);assert.equal(typeof r.id,'string');assert.match(r.id as string,/^[a-f0-9]{64}$/u);return r as unknown as Readonly<{kind:Kind;id:string}>;}
export function input(value:unknown):Input{const r=row(value);assert.deepEqual(Object.keys(r).sort(),['facts','handle']);handle(r.handle,'linked-input');const f=row(r.facts);assert.deepEqual(Object.keys(f).sort(),['byteLength','contentSha256','displayName','modifiedTime','sourceId']);assert.equal(f.modifiedTime,null);assert.equal(typeof f.byteLength,'number');assert.equal(typeof f.displayName,'string');assert.equal(typeof f.sourceId,'string');assert.equal(typeof f.contentSha256,'string');assert.match(f.contentSha256 as string,/^[a-f0-9]{64}$/u);return r as unknown as Input;}
export function page(value:unknown):Readonly<{entries:readonly Entry[];done:boolean}>{const r=row(value);assert.deepEqual(Object.keys(r).sort(),['done','entries']);assert.equal(typeof r.done,'boolean');assert.ok(Array.isArray(r.entries)&&r.entries.length<=64);for(const e of r.entries){const n=row(e);assert.deepEqual(Object.keys(n).sort(),['byteLength','displayName','entryId','kind']);assert.match(String(n.entryId),/^[a-f0-9]{64}$/u);assert.ok(['file','directory','link','other','unknown'].includes(String(n.kind)));assert.equal(typeof n.displayName,'string');}return r as unknown as Readonly<{entries:readonly Entry[];done:boolean}>;}
export function bytes(value:unknown):Uint8Array{assert.ok(value instanceof Uint8Array);return value;}
export async function linkedSessionFixtureCurrentV1(context:TestContext,run:(f:Awaited<ReturnType<typeof create>>)=>Promise<void>):Promise<void>{
 await native(context,async base=>{const f=await create(base);let failed=false,primary:unknown;try{await run(f);}catch(error){failed=true;primary=error;}try{await f.close();}catch(cleanup){throw new AggregateError([...(failed?[primary]:[]),cleanup],'Linked session fixture retirement failed.',{cause:cleanup});}if(failed)throw primary;});
}
type Native=Parameters<Parameters<typeof native>[1]>[0];
async function create(base:Native){
 const handles=new Handles(),controller=new AbortController(),scope=Object.freeze({signal:controller.signal,assertCurrent(){controller.signal.throwIfAborted();base.scope.assertCurrent();}});
 const owner=Session.create({appDataPath:base.appDataPath,catalogId:CATALOG,grants:base.grants,originals:base.linked,filesystem:base.role,handles,scope,unretired(){throw new Error('Unexpected actual linked session quarantine.');}});
 const run=(packet:Readonly<Record<string,unknown>>,signal?:AbortSignal)=>base.track(owner.execute(packet,signal));
 const scans=new Set<Handle>(),inputs=new Set<Input>();let closing:Promise<void>|undefined;
 async function scan(grantId=base.grant.grantId,entryId?:string):Promise<Handle>{const result=row(await run({operation:'scan-open',grantId,...(entryId?{entryId}:{})})),h=handle(result.handle,'linked-scan');scans.add(h);return h;}
 async function pick(name:string,selected?:Handle):Promise<Readonly<{scan:Handle;entry:Entry}>>{const h=selected??await scan();while(true){const p=page(await run({operation:'scan-next',handle:h})),found=p.entries.find(entry=>entry.displayName===name);if(found)return{scan:h,entry:found};if(p.done)throw new Error('Real native scan did not find selected entry.');}}
 async function open(name:string):Promise<Input>{const chosen=await pick(name);try{const result=input(await run({operation:'input-open',scan:chosen.scan,entryId:chosen.entry.entryId}));inputs.add(result);return result;}finally{await run({operation:'scan-close',handle:chosen.scan});scans.delete(chosen.scan);}}
 async function write(name='Selected native.DNG',data?:Uint8Array<ArrayBuffer>){const prepared=await base.prepare(name,data);await prepared.input.close();return prepared;}
 return{...base,owner,handles,run,scan,pick,open,write,scope,controller,
  async closeInput(value:Input){await run({operation:'input-close',handle:value.handle});inputs.delete(value);},
  async closeScan(value:Handle){await run({operation:'scan-close',handle:value});scans.delete(value);},
  async file(name:string,data:Uint8Array){await writeFile(join(base.rootPath,name),data);},
  close():Promise<void>{closing??=Promise.resolve().then(async()=>{base.release();const failures:unknown[]=[];try{await owner.close();}catch(error){failures.push(error);}try{await handles.closeAll();}catch(error){failures.push(error);}if(failures.length)throw new AggregateError(failures,'Linked session resources did not retire.',{cause:failures[0]});});return closing;},
 };
}
