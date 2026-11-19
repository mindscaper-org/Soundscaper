/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {LightscaperPhotoBackendSwitchCurrentV1 as Switch} from '../src/common/editor/controller/composition/lightscaper-photo-backend-switch-current-v1.ts';
import {deferred,remainsPending} from './helpers/async-test-control.ts';
void test('Same-backend linked revocation fences the actual workspace and joins retirement before opening management work', {timeout:15000},async context=>{
 const backend=new Switch({nativeAvailable:true}),gate=deferred<void>(),events:string[]=[];const release=()=>{gate.resolve();};context.signal.addEventListener('abort',release,{once:true});
 const unregister=backend.register({target:null,safety:()=> 'ready',fence(){events.push('fence');},async retireAndJoin(){events.push('retire');await gate.promise;events.push('retired');}});let work:Promise<boolean>|undefined;
 try{work=backend.retireAndRun(async()=>{events.push('actual-management');});assert.deepEqual(events,['fence','retire']);assert.equal(await remainsPending(work),true);assert.equal(backend.snapshot().epoch,0);gate.resolve();assert.equal(await work,true);assert.deepEqual(events,['fence','retire','retired','actual-management']);assert.equal(backend.snapshot().backend,'web');assert.equal(backend.snapshot().epoch,1);}
 finally{gate.resolve();await Promise.allSettled(work?[work]:[]);unregister();await backend.close();context.signal.removeEventListener('abort',release);}
});
void test('Linked management refuses an open dialog and never runs after failed real retirement',async()=>{
 const backend=new Switch({nativeAvailable:true});let called=0;const off=backend.register({target:null,safety:()=> 'open-surface',fence(){throw new Error('Unexpected fence');},async retireAndJoin(){}});
 assert.equal(await backend.retireAndRun(async()=>{called++;}),false);assert.equal(called,0);off();const reason=Symbol('actual retirement failure');const detach=backend.register({target:null,safety:()=> 'ready',fence(){},async retireAndJoin(){throw reason;}});
 let caught:unknown;try{await backend.retireAndRun(async()=>{called++;});}catch(error){caught=error;}assert.equal(caught,reason);assert.equal(called,0);assert.equal(backend.snapshot().failed,true);detach();await assert.rejects(backend.close());
});
