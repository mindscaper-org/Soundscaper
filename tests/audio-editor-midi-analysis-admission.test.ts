/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { AnalysisActions } from '../src/common/editor/controller/analysis/analysis-composition.ts';
import { createMidiPendingSnapshotAdmission } from '../src/common/editor/controller/composition/internal/midi-controller-port.ts';
import { deferred, settle } from './helpers/async-test-control.ts';
import { createMidiPendingAnalysisActions } from '../src/common/editor/controller/composition/internal/midi-controller-port.ts';

function fixture({pending=true, sourceReady=true, allowed=true}={}) {
 const ready=deferred<void>(), source=deferred<void>();
 if(sourceReady) source.resolve();
 let project={id:'project',revision:0}, selected='first:0:48000', active=true, calls=0, settlements=0, preparations=0;
 const requests: {method:string;args:unknown[];revision:number}[]=[];
 const method=(name:string)=>(...args:unknown[])=>{calls++;requests.push({method:name,args,revision:project.revision});return Promise.resolve(null);};
 const service: AnalysisActions={run:method('run'),plotSpectrum:method('spectrum'),findClipping:method('clipping'),
  captureContrast:method('contrast'),repeatLast:method('repeat'),measureLoudness:method('loudness'),cancel:()=>true};
 const ports={hasPendingEdits:()=>pending,getProject:()=>project,captureTarget:()=>JSON.stringify([project.id,selected]),active:()=>active,
  settled:async()=>{settlements++;await ready.promise;},prepareAudio:async()=>{preparations++;await source.promise;}};
 const restrict=<Args extends unknown[],Result>(operation:(...args:Args)=>Result)=>(...args:Args):Result=>{
  if(!allowed) throw new RangeError('Audio analysis is unsupported.');
  return operation(...args);
 };
 const actions=createMidiPendingAnalysisActions(service,ports,restrict);
 return {actions,ports,requests,get calls(){return calls;},get settlements(){return settlements;},get preparations(){return preparations;},
  publish:()=>{project={...project,revision:project.revision+1};pending=false;ready.resolve();},
  changeSelection:()=>{selected='other:0:24000';},changeProject:()=>{project={id:'other-project',revision:0};},dispose:()=>{active=false;},
  fail:(error:Error)=>ready.reject(error),prepare:()=>source.resolve()};
}
type Actions=ReturnType<typeof fixture>['actions'];
const requests=[
 {action:'run',args:['track'],method:'run',invoke:(actions:Actions)=>actions.run('track')},
 {action:'plotSpectrum',args:['master'],method:'spectrum',invoke:(actions:Actions)=>actions.plotSpectrum('master')},
 {action:'findClipping',args:['track',{minimumSamples:3}],method:'clipping',invoke:(actions:Actions)=>actions.findClipping('track',{minimumSamples:3})},
 {action:'contrast',args:['foreground','master'],method:'contrast',invoke:(actions:Actions)=>actions.contrast('foreground','master')},
 {action:'repeatLast',args:[],method:'repeat',invoke:(actions:Actions)=>actions.repeatLast()},
 {action:'measureLoudness',args:[],method:'loudness',invoke:(actions:Actions)=>actions.measureLoudness()},
];
for(const {action,args,method,invoke} of requests) {
 test(`pending ${action} waits for owned MIDI before the existing analysis owner begins`,async()=>{
  const f=fixture();
  const operation=invoke(f.actions);await settle();assert.equal(f.calls,0);assert.equal(f.settlements,1);
  f.publish();assert.equal(await operation,null);assert.deepEqual(f.requests,[{method,args,revision:1}]);
 });
 test(`idle ${action} keeps normal argument and result forwarding`,async()=>{
  const f=fixture({pending:false});
  const operation=invoke(f.actions);assert.equal(f.calls,1);assert.equal(f.settlements,0);assert.equal(await operation,null);
 });
}
test('unsupported analysis rejects before settling any pending MIDI or creating a task',()=>{
 const f=fixture({allowed:false});assert.throws(()=>f.actions.plotSpectrum(),/unsupported/u);assert.equal(f.settlements,0);assert.equal(f.calls,0);
});
test('source activation must finish after MIDI publication before a report can begin',async()=>{
 const f=fixture({sourceReady:false});const reading=f.actions.plotSpectrum();await settle();f.publish();await settle();
 assert.equal(f.preparations,1);assert.equal(f.calls,0);f.prepare();assert.equal(await reading,null);
});
for(const change of ['changeSelection','changeProject','dispose'] as const)test(`${change} retires the old analysis without retargeting its report`,async()=>{
 const f=fixture(), reading=f.actions.plotSpectrum();void reading.catch(()=>{});await settle();f[change]();f.publish();
 await assert.rejects(reading,{name:'AbortError'});assert.equal(f.calls,0);
});
test('a new analysis retires an older pending read while the preceding MIDI publication remains intact',async()=>{
 const f=fixture();const first=f.actions.contrast('foreground');void first.catch(()=>{});await settle();
 const second=f.actions.plotSpectrum();await assert.rejects(first,{name:'AbortError'});assert.equal(f.calls,0);
 f.publish();assert.equal(await second,null);assert.deepEqual(f.requests,[{method:'spectrum',args:[],revision:1}]);
});
test('canceling an independent effect admission does not retire pending analysis',async()=>{
 const f=fixture(), effect=createMidiPendingSnapshotAdmission(f.ports);
 const analyzing=f.actions.plotSpectrum(), applying=Promise.resolve(effect.run(()=>1)());void applying.catch(()=>{});
 await settle();effect.cancel();await assert.rejects(applying,{name:'AbortError'});f.publish();assert.equal(await analyzing,null);
});
test('a current source-write failure remains visible without starting analysis',async()=>{
 const f=fixture(), failure=new Error('Source write failed'),reading=f.actions.plotSpectrum();void reading.catch(()=>{});
 await settle();f.fail(failure);await assert.rejects(reading,failure);assert.equal(f.calls,0);
});
