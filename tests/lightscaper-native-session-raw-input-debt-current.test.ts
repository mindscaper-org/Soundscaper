/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import type { RawInputDebtWorkerCurrentV1 } from './helpers/lightscaper-native-session-raw-input-debt-worker-current.ts';
void test('Main RAW input unreturned genuine native cleanup refusal retains its shared handle booking', {timeout:15000}, async context=>{
 const appDataPath=await mkdtemp(join(tmpdir(),'lightscaper-raw-input-debt-'));let worker:Worker|undefined,exited=false,termination:Promise<number>|undefined,received:unknown,failure:unknown,expired=false;
 const stop=():void=>{if(worker&&!exited){termination??=worker.terminate();void termination.catch(()=>undefined);}};context.signal.addEventListener('abort',stop,{once:true});const timer=setTimeout(()=>{expired=true;stop();},12000);
 try{worker=new Worker(new URL('./helpers/lightscaper-native-session-raw-input-debt-worker-current.ts',import.meta.url),{execArgv:['--import',import.meta.resolve('tsx')],resourceLimits:{maxOldGenerationSizeMb:96},workerData:{appDataPath} satisfies RawInputDebtWorkerCurrentV1});
  const actual=worker,exit=new Promise<number>(resolve=>{actual.on('message',(value:unknown)=>{received=value;});actual.on('error',(error:unknown)=>{failure=error;});actual.once('exit',code=>{exited=true;resolve(code);});});
  if(context.signal.aborted)stop();const code=await exit;if(failure!==undefined)throw failure;assert.equal(expired,false);assert.equal(code,0);
  assert.deepEqual(received,{actualClose:true,originalQuarantined:true,attemptRefused:true,handleDebt:1,notified:1,registryCloseRefused:true,mediaCloseRefused:true});
 }finally{clearTimeout(timer);context.signal.removeEventListener('abort',stop);if(worker&&!exited){termination??=worker.terminate();await termination;}else if(termination)await termination;await rm(appDataPath,{recursive:true,force:true});}
});
