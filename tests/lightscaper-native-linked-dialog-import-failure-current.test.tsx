/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import React,{act} from 'react';
import Dialog from '../src/common/editor/ui/lightscaper/PhotoLinkedLibraryDialogCurrentV1.tsx';
import {PhotoLibraryLinkedCommandsCurrentV1 as Commands} from '../src/common/editor/controller/composition/photo-library-linked-commands-current-v1.ts';
import {PhotoLibrarySessionKernelV2 as Kernel} from '../src/lightscaper/controller/photo-library-session-kernel-v2.ts';
import type {PhotoLibrarySessionCurrentV1 as Session} from '../src/lightscaper/controller/photo-library-session-current-v1.ts';
import type {PhotoLibraryImportItemV1 as Item} from '../src/common/editor/photo-library-session-port-v1.ts';
import {lightscaperPhotoLinkedCopyCurrentV1 as copyFor} from '../src/common/i18n/lightscaper-photo-linked-copy-current-v1.ts';
import {linkedWorkflowFixtureCurrentV1 as fixture,linked,options} from './helpers/lightscaper-native-linked-workflow-integration-fixture-current.ts';
import {mountPhotoImportUi} from './helpers/photo-import-options-react-fixture.tsx';
import {reactProps} from './helpers/react-test-dom.ts';
import {settle,waitFor} from './helpers/async-test-control.ts';

void test('Linked dialog displays actual per-file Current refusal while retaining real successful Photo ACK count',options,async context=>fixture(context,async f=>{
 await f.file();const descriptor=Object.getOwnPropertyDescriptor(Kernel.prototype,'importFiles');assert.ok(descriptor);const original=Kernel.prototype.importFiles,observed:Item[]=[];
 // Observe the exact original owning promise before the complete factory captures
 // its method. No acknowledgement, result, decoder or body verifier is replaced.
 Object.defineProperty(Kernel.prototype,'importFiles',{...descriptor,value:function(this:Kernel,...args:Parameters<Kernel['importFiles']>):ReturnType<Kernel['importFiles']>{
  const actual=Reflect.apply(original,this,args) as ReturnType<Kernel['importFiles']>;void actual.then(items=>{observed.push(...items);},()=>undefined);return actual;
 }});
 let session:Session|undefined,mounted:Awaited<ReturnType<typeof mountPhotoImportUi>>|undefined,commands:Commands|undefined,unregister:()=>void=()=>undefined;const accepted=new Set<Promise<unknown>>(),retirements=new Set<()=>Promise<void>>();let closed=false;
 const join=async():Promise<void>=>{await settle();while(accepted.size){await Promise.allSettled([...accepted]);await settle();}};
 try{
  session=(await f.open()).session;const currentSession=session;
  commands=new Commands({async resolveSession(value){assert.equal(value,currentSession);const runtime=linked(value);assert.ok(runtime);return runtime;},async revoke(){assert.fail('No revoke belongs to import failure visibility.');}});
  unregister=commands.register(action=>{const actual=(async()=>{await action({signal:context.signal,acquire:async()=>currentSession,isCurrent:()=>!context.signal.aborted,refresh:async()=>{await currentSession.readPage();}});return 'completed';})();accepted.add(actual);void actual.then(()=>{accepted.delete(actual);},()=>{accepted.delete(actual);});return actual;},close=>{retirements.add(close);return()=>{retirements.delete(close);};});
  const owner=commands;mounted=await mountPhotoImportUi(()=> <Dialog locale="en" commands={owner} onClose={()=>{closed=true;}}/>);const view=mounted;
  const event=async(selector:string,handler:string,value:unknown={}):Promise<void>=>{await act(async()=>{reactProps(view.dom.one(selector))[handler]?.(value);await join();});};
  await waitFor(async()=>{await act(async()=>{await join();});return !reactProps(view.dom.one('[data-photo-linked-choose]')).disabled;},'real initial grant read');
  await event('[data-photo-linked-choose]','onClick');
  const entries=view.dom.container.querySelectorAll('[data-photo-linked-entry]');assert.equal(entries.length,2);assert.deepEqual(entries.map(node=>(node.closest('label')?.textContent??'').trim()).sort(),['Workflow native.DNG','photo.bin'].sort());
  for(const node of entries)await act(async()=>{reactProps(node).onChange?.({currentTarget:{checked:true}});await join();});
  await event('[data-photo-linked-import]','onClick');
  await waitFor(async()=>{await act(async()=>{await join();});return observed.length===2&&!reactProps(view.dom.one('[data-photo-linked-import]')).disabled;},'actual two-item Current import and native publication/cleanup');
  const failed=observed.find(item=>item.status==='failed'),imported=observed.find(item=>item.status==='imported');assert.ok(failed);assert.ok(imported);assert.equal(failed.fileName,'photo.bin');assert.ok(failed.message);assert.ok(imported.photoId);
  assert.equal(view.dom.one('[data-photo-linked-notice]').textContent,copyFor('en').photoLinkedImported.replace('{count}','1'));
  const alert=view.dom.find('[role="alert"]')?.textContent??'';assert.ok(alert.includes(failed.fileName),'Actual per-file refusal must identify its real filename.');assert.ok(alert.includes(failed.message),'The returned owning refusal message must be visible.');
  const page=await currentSession.readPage();assert.equal(page.totalCount,1);assert.equal(page.rows[0]?.id,imported.photoId);const stored=await f.catalog.loadPhoto(f.catalogId,imported.photoId);assert.ok(stored);assert.equal(stored.original.retention,'linked');
  const roots=await f.media.catalogOriginals.readPage({catalogId:f.catalogId});assert.equal(roots.roots.length,1);assert.equal(roots.roots[0]?.photoId,imported.photoId);assert.equal(roots.roots[0]?.importId,null);assert.equal(f.workers.active(),0);
  await event('[data-photo-linked-close]','onClick');await waitFor(async()=>{await act(async()=>{await join();});return closed;},'actual linked scan and dialog close');
 }finally{
  await act(async()=>{await commands?.cancelAndJoin();await join();});await mounted?.dispose();await Promise.allSettled([...retirements].map(close=>close()));unregister();await session?.close();Object.defineProperty(Kernel.prototype,'importFiles',descriptor);
 }
}));
