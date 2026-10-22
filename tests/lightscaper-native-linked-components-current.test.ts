/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { spawn,type ChildProcessWithoutNullStreams } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test,type TestContext } from 'node:test';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import { nativeGrantedFilesystemFixtureCurrentV1 as native } from './helpers/lightscaper-native-granted-filesystem-fixture-current.ts';
import { grantedFsPathCurrentV1 as path } from './helpers/lightscaper-native-granted-filesystem-fixture-current.ts';
import { scopePhotoCurrentV1 } from './helpers/lightscaper-native-library-scope-integration-fixture-current.ts';
import { normalizePhotoDocumentCurrentV1 as photo } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { readDesktopPhotoOriginalTicketCurrentV1 as ticket } from '../src/lightscaper/desktop-photo-original-contract-current-v1.ts';
const options={timeout:15000,concurrency:false};
type Native=Parameters<Parameters<typeof native>[1]>[0];
async function withScopes(context:TestContext,base:Native,run:(scopes:Scopes)=>Promise<void>,linked=true):Promise<void>{
 const children=new Map<ChildProcessWithoutNullStreams,Promise<void>>(),binary=base.native.child.spawnargs[0];assert.ok(binary);let scopes:Scopes|undefined,failed=false,primary:unknown;const errors:unknown[]=[];
 const kill=()=>{for(const child of children.keys())if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');};const timer=setTimeout(kill,13500);context.signal.addEventListener('abort',kill,{once:true});
 try{scopes=await Scopes.open({appDataPath:join(base.directory,'app-data'),...(linked?{services:{startGrantedFilesystem(){const child=spawn(binary,[],{stdio:['pipe','pipe','pipe'],windowsHide:true});children.set(child,new Promise<void>(resolve=>{child.once('close',()=>{resolve();});}));return child;},chooseLinkedRoot:async()=>({path:path(base.rootPath),displayName:'Actual selected folder'})}}:{})});await run(scopes);}
 catch(error){failed=true;primary=error;}
 try{await scopes?.close();}catch(error){errors.push(error);}for(const child of children.keys())if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await Promise.all(children.values());clearTimeout(timer);context.signal.removeEventListener('abort',kill);
 if(errors.length)throw new AggregateError([...(failed?[primary]:[]),...errors],'Selected components did not join actual native FS roles.',{cause:errors[0]});if(failed)throw primary;
}
void test('Actual selected Scopes trusted linked services compose same-namespace Catalog verifier, six tickets and durable grants across reopen',options,async context=>native(context,async f=>withScopes(context,f,async scopes=>{
 const selected=await scopes.openSelected({name:'Actual linked library'}),components=await scopes.openComponents(selected.scope);let id:string,saved:ReturnType<typeof photo>|undefined;
 try{assert.ok(components.linked);const grant=await components.linked.grants.authorize();assert.ok(grant);id=grant.grantId;const e=scopePhotoCurrentV1();await writeFile(join(f.rootPath,'Current linked.DNG'),e.bytes);
  const input=await components.linked.originals.prepareInput(id,[path('Current linked.DNG')]);try{const root=await components.catalog.loadCatalog(selected.catalogId);assert.ok(root);saved=photo({...e.photo,catalogId:selected.catalogId,original:{...e.photo.original,storageKey:input.facts.sourceId,retention:'linked',name:'Current linked.DNG'}});
   await components.linked.originals.publishInput(input,{catalogId:selected.catalogId,importId:'selected-linked',photoId:saved.id,original:saved.original,metadata:{name:saved.original.name,mimeType:saved.original.mimeType}});
   await components.catalog.publishPhotos(selected.catalogId,root.revision,[saved]);await components.media.catalogOriginals.promote(selected.catalogId,'selected-linked',[saved.id]);}
  finally{await input.close();}
 }finally{await components.close();}
 const reopened=await scopes.openComponents(selected.scope);try{assert.ok(reopened.linked);assert.equal((await reopened.linked.grants.revalidate(id))?.revoked,false);assert.ok(saved);const request={catalogId:selected.catalogId,photoId:saved.id,original:saved.original},single=ticket(await reopened.originalTickets.transport.open(request),request);try{const bytes=await reopened.originalTickets.transport.read(single,0,1);assert.ok(bytes instanceof Uint8Array);assert.equal(bytes.byteLength,1);}finally{await reopened.originalTickets.transport.close({id:single.id});}}
 finally{await reopened.close();}
})));
void test('Default actual Scopes remains managed-only without trusted native linked services',options,async context=>native(context,async f=>withScopes(context,f,async scopes=>{
 const selected=await scopes.openSelected({name:'Existing default library'}),components=await scopes.openComponents(selected.scope);try{assert.equal(components.linked,undefined);const root=await components.catalog.loadCatalog(selected.catalogId);assert.ok(root);}finally{await components.close();}
},false)));
void test('Scopes rejects incomplete trusted linked service pairs before starting a role or chooser',options,async context=>native(context,async f=>{
 let calls=0;await assert.rejects(Scopes.open({appDataPath:join(f.directory,'app-data'),services:{chooseLinkedRoot:async()=>{calls++;return null;}}}));assert.equal(calls,0);
}));
