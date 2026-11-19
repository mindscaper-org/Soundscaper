/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import React,{act,StrictMode,useLayoutEffect,useRef} from 'react';
import Dialog from '../src/common/editor/ui/lightscaper/PhotoLinkedLibraryDialogCurrentV1.tsx';
import {PhotoLibraryLinkedCommandsCurrentV1 as Commands} from '../src/common/editor/controller/composition/photo-library-linked-commands-current-v1.ts';
import {linkedWorkflowFixtureCurrentV1 as fixture,linked,options} from './helpers/lightscaper-native-linked-workflow-integration-fixture-current.ts';
import {mountPhotoImportUi} from './helpers/photo-import-options-react-fixture.tsx';
import {reactProps,ReactTestElement} from './helpers/react-test-dom.ts';
import {deferred,settle,waitFor} from './helpers/async-test-control.ts';

for(const strict of [false,true])void test(`Actual linked dialog serializes initial grants/presets and real chooser/scan (${strict?'StrictMode':'ordinary mount'})`,options,async context=>fixture(context,async f=>{
 await f.file();const {session}=await f.open(),entered=deferred<void>(),gate=deferred<void>(),retirements=new Set<()=>Promise<void>>();let calls=0,active=0,maximum=0,closed=false;const committed:unknown[]=[];const accepted=new Set<Promise<unknown>>();
 const release=():void=>{gate.resolve();};context.signal.addEventListener('abort',release,{once:true});
 const commands=new Commands({async resolveSession(value){assert.equal(value,session);const runtime=linked(value);assert.ok(runtime);return runtime;},async revoke(){assert.fail('No revocation belongs to initial dialog loading.');}});
 // Only the existing trusted callback-owner seam is held. Every domain result
 // comes from the actual complete Current Session, Main service and SQLite/FS.
 const unregister=commands.register(action=>{
  const actual=(async()=>{calls++;active++;maximum=Math.max(maximum,active);
   try{entered.resolve();await gate.promise;await action({signal:context.signal,acquire:async()=>session,isCurrent:()=>!context.signal.aborted,refresh:async()=>{await session.readPage();}});return 'completed';}
   finally{active--;}
  })();accepted.add(actual);void actual.then(()=>{accepted.delete(actual);},()=>{accepted.delete(actual);});return actual;
 },close=>{retirements.add(close);return()=>{retirements.delete(close);};});
 // Keep React's event scope open through the actual registered command and
 // finalizers. Observe the original returned task; do not replace its results.
 const joinCommands=async():Promise<void>=>{await settle();while(accepted.size){await Promise.allSettled([...accepted]);await settle();}};
 let mounted:Awaited<ReturnType<typeof mountPhotoImportUi>>|undefined;
 try{
  function Mounted(){const host=useRef<HTMLDivElement>(null);useLayoutEffect(()=>{const node=host.current?.querySelector('[data-photo-linked-choose]');assert.ok(node instanceof ReactTestElement);committed.push(reactProps(node).disabled);},[]);return <div ref={host}><Dialog locale="en" commands={commands} onClose={()=>{closed=true;}}/></div>;}
  mounted=await mountPhotoImportUi(()=>strict?<StrictMode><Mounted/></StrictMode>:<Mounted/>);
  await f.track(entered.promise);assert.ok(calls>=1);assert.equal(maximum,1);assert.equal(reactProps(mounted.dom.one('[data-photo-linked-choose]')).disabled,true);assert.ok(committed.length>0);assert.ok(committed.every(value=>value===true),'Choose must be disabled in its first committed render, before passive initialization starts.');
  assert.equal(mounted.dom.find('[role="alert"]')?.textContent??null,null,'Initial grants/preset reads must share one real command without a busy failure.');
  await mounted.event('[data-photo-import-options]','onToggle',{currentTarget:{open:true}});assert.equal(maximum,1);
  await act(async()=>{gate.resolve();await joinCommands();});
  const current=mounted;
  const event=async(selector:string,handler:string,value:unknown={}):Promise<void>=>{await act(async()=>{reactProps(current.dom.one(selector))[handler]?.(value);await joinCommands();});};
  await waitFor(async()=>{await act(async()=>{await joinCommands();});return !reactProps(current.dom.one('[data-photo-linked-choose]')).disabled;},'actual initial grants/preset command retirement');
  assert.equal(current.dom.find('[role="alert"]')?.textContent??null,null);assert.equal(maximum,1);
  await event('[data-photo-linked-choose]','onClick');
  await waitFor(async()=>{await act(async()=>{await joinCommands();});return current.dom.container.querySelectorAll('[data-photo-linked-entry]').length===2;},'actual chooser NativeRoot and maintained RAW directory scan').catch((cause:unknown)=>{
   const entries=[...current.dom.container.querySelectorAll('[data-photo-linked-entry]')].map(node=>(node.closest('label')?.textContent??'').trim().slice(0,128));
   const alerts=[...current.dom.container.querySelectorAll('[role="alert"]')].slice(0,4).map(node=>node.textContent.slice(0,256));
   throw new Error(`Actual linked scan did not match fixture inventory: ${JSON.stringify({entryCount:entries.length,entries,alerts,calls,active,maximum})}`,{cause});
  });
  assert.deepEqual([...current.dom.container.querySelectorAll('[data-photo-linked-entry]')].map(node=>(node.closest('label')?.textContent??'').trim()).sort(),['Workflow native.DNG','photo.bin'].sort());
  assert.equal(current.dom.find('[role="alert"]')?.textContent??null,null);assert.equal(maximum,1);assert.ok(calls>=2);
  await event('[data-photo-linked-check]','onClick');
  await waitFor(async()=>{await act(async()=>{await joinCommands();});return !reactProps(current.dom.one('[data-photo-linked-watch]')).disabled;},'actual bounded empty-catalog inspection');
  const beforeWatch=calls;await event('[data-photo-linked-watch]','onChange',{currentTarget:{checked:true}});
  await waitFor(async()=>{await act(async()=>{await joinCommands();});return calls>beforeWatch;},'actual displayed-page watch remains usable after effect replay');
  await event('[data-photo-linked-close]','onClick');
  await waitFor(async()=>{await act(async()=>{await joinCommands();});return closed;},'actual scan close and dialog command drain');
  assert.equal(active,0);
 }finally{
  await act(async()=>{gate.resolve();await commands.cancelAndJoin();await joinCommands();});await mounted?.dispose();await Promise.allSettled([...retirements].map(close=>close()));unregister();context.signal.removeEventListener('abort',release);
 }
}));
