/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PhotoLibraryLinkedWatchCurrentV1 as Watch} from '../src/common/editor/controller/composition/photo-library-linked-watch-current-v1.ts';
import {deferred,remainsPending} from './helpers/async-test-control.ts';
void test('Displayed-page linked watch has one real accepted poll and close aborts, then joins that actual callback', {timeout:15000},async context=>{
 const gate=deferred<void>(),entered=deferred<void>(),reasons:unknown[]=[];let calls=0,seen:AbortSignal|undefined;const watch=new Watch(error=>{reasons.push(error);});const release=()=>{gate.resolve();entered.resolve();};context.signal.addEventListener('abort',release,{once:true});let closing:Promise<void>|undefined;
 try{watch.start(async signal=>{calls++;seen=signal;entered.resolve();await gate.promise;signal.throwIfAborted();});await entered.promise;closing=watch.close();assert.equal(watch.close(),closing);assert.equal(seen?.aborted,true);assert.equal(await remainsPending(closing),true);gate.resolve();await closing;assert.equal(calls,1);assert.deepEqual(reasons,[]);assert.throws(()=>watch.start(async()=>{}));}
 finally{release();await watch.close();context.signal.removeEventListener('abort',release);}
});
void test('Watch stops scheduling after a non-cancellation inspection failure and preserves its exact reason',async()=>{
 const reason=Symbol('unsafe or corrupt actual source'),observed=deferred<unknown>();let calls=0;const watch=new Watch(error=>{observed.resolve(error);});
 try{watch.start(async()=>{calls++;throw reason;});assert.equal(await observed.promise,reason);await watch.stop();assert.equal(calls,1);}finally{await watch.close();}
});
