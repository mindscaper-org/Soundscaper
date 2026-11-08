/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecordingResumeConfirmation } from '../src/common/editor/recording-input-events.ts';
import { createRecordingController } from '../src/common/editor/recording.js';
import { createRoutedRecordingController, type RecordingCaptureControllerLike } from '../src/common/editor/controller/recording/internal/recording-session-service.ts';
import { createSoundActivatedRecordingCaptureSession } from '../src/common/editor/controller/recording/internal/sound-activation/sound-activated-recording-capture-session.ts';
import { deferred } from './helpers/async-test-control.ts';

function fixture(sampleRate = 48000) {
	let state='paused',nextTimer=0,changes=0;
	const posted: Readonly<Record<string,unknown>>[]=[],errors: Error[]=[],timers=new Map<number,()=>void>();
	const confirmation=createRecordingResumeConfirmation({sampleRate,timeoutMs:5000,
		assertPaused:scheduled=>{if(state!=='paused'&&!scheduled)throw new Error('Not paused');},
		postMessage:message=>{posted.push(message);},onScheduled:()=>{state='recording';changes++;},fail:error=>{errors.push(error);state='failed';},
		setTimeout:callback=>{timers.set(++nextTimer,callback);return nextTimer;},clearTimeout:timer=>{timers.delete(timer);}
	});
	const ack=()=>{const message=posted.at(-1);assert.ok(message);confirmation.handle({type:'resume-scheduled',requestId:message.requestId,startFrame:message.startFrame});};
	return{confirmation,posted,errors,timers,ack,state:()=>state,changes:()=>changes,pause:()=>{state='paused';confirmation.cancel();}};
}

test('native Resume acknowledgement retains its exact requested frame and permits future correction',async()=>{
	const f=fixture(),first=f.confirmation.resume({startFrame:1000});f.ack();assert.deepEqual(await first,{startFrame:1000});
	const second=f.confirmation.resume({startFrame:2000});f.ack();assert.deepEqual(await second,{startFrame:2000});assert.equal(f.timers.size,0);
});

for(const rate of [44100,96000])test(`a missed native Resume retries on its ${rate}Hz context clock`,async()=>{
	const f=fixture(rate),pending=f.confirmation.resume({startFrame:1000}),request=f.posted.at(-1);assert.ok(request);
	f.confirmation.handle({type:'resume-missed',requestId:request.requestId,firstAvailableFrame:1001});
	assert.equal(f.posted.at(-1)?.startFrame,1001+Math.ceil(rate/4));f.ack();assert.deepEqual(await pending,{startFrame:1001+Math.ceil(rate/4)});
});

test('Stop cancels a pending acknowledgement and stale native messages cannot claim a new request',async()=>{
	const f=fixture(),first=f.confirmation.resume({startFrame:1000}),rejected=assert.rejects(first,{name:'AbortError'}),old=f.posted.at(-1);assert.ok(old);
	f.confirmation.cancel();await rejected;const second=f.confirmation.resume({startFrame:2000});
	f.confirmation.handle({type:'resume-scheduled',requestId:old.requestId,startFrame:1000});assert.equal(f.changes(),0);
	f.ack();await second;assert.equal(f.changes(),1);
});

test('Pause cancels an accepted future Resume and ignores its already queued resumed publication',async()=>{
	const f=fixture(),pending=f.confirmation.resume({startFrame:1000});f.ack();await pending;f.pause();
	assert.equal(f.confirmation.handle({type:'resumed',frame:1000}),true);assert.equal(f.state(),'paused');assert.equal(f.changes(),1);
});

test('a current malformed native acknowledgement fails instead of claiming another capture frame',async()=>{
	const f=fixture(),pending=f.confirmation.resume({startFrame:1000}),rejected=assert.rejects(pending,/confirm a future resume/),request=f.posted.at(-1);assert.ok(request);
	f.confirmation.handle({type:'resume-scheduled',requestId:request.requestId,startFrame:999});await rejected;assert.equal(f.errors.length,1);assert.equal(f.timers.size,0);
});

test('current acknowledgement timeout reports once while cancellation releases its timer',async()=>{
	const f=fixture(),pending=f.confirmation.resume({startFrame:1000}),rejected=assert.rejects(pending,{name:'TimeoutError'}),timeout=[...f.timers.values()][0];assert.ok(timeout);timeout();await rejected;assert.equal(f.errors.length,1);assert.equal(f.timers.size,0);
	const canceled=fixture(),next=canceled.confirmation.resume({startFrame:1000}),cancelled=assert.rejects(next,{name:'AbortError'});canceled.confirmation.cancel();await cancelled;assert.equal(canceled.timers.size,0);assert.deepEqual(canceled.errors,[]);
});

test('the production controller routes confirmed Resume and keeps a user Pause authoritative',async()=>{
	const posted: Readonly<Record<string,unknown>>[]=[];
	const node={port:{onmessage:null as ((event:{data:Record<string,unknown>})=>void)|null,start(){},postMessage(message:Readonly<Record<string,unknown>>){posted.push(message);}},connect(){},disconnect(){}};
	const options={channelCount:1,context:{sampleRate:48000,audioWorklet:{async addModule(){}},createMediaStreamSource:()=>({connect(){},disconnect(){}}),destination:{}},stream:{getTracks:()=>[]},nodeFactory:()=>node};
	const controller=await createRecordingController(options);
	controller.start();controller.pause();node.port.onmessage?.({data:{type:'paused',frame:128}});
	const pending=controller.resumeConfirmed({startFrame:1000}),request=posted.at(-1);assert.ok(request);
	node.port.onmessage?.({data:{type:'resume-scheduled',requestId:request.requestId,startFrame:1000}});assert.deepEqual(await pending,{startFrame:1000});
	assert.equal(controller.pause(),true);node.port.onmessage?.({data:{type:'resumed',frame:1000}});assert.equal(controller.state,'paused');
	const stopped=controller.stop();node.port.onmessage?.({data:{type:'stopped',frame:128}});await stopped;await controller.dispose();
});

function inputController(offset = 0, error?: Error) {
	let state = 'ready'; const frames: number[] = [];
	const controller: RecordingCaptureControllerLike = { get state() { return state; }, start(){state='recording';},pause(){state='paused';return true;},resume(){state='recording';return true;},stop(){state='stopped';},setMonitoring(){},setInputGain(){},
		async resumeConfirmed({startFrame}) { if(error)throw error;frames.push(startFrame);state='recording';return{startFrame:startFrame+(frames.length===1?offset:0)}; } };
	return{controller,frames,state:()=>state};
}

test('independent routed inputs confirm and correct to the same native Resume frame',async()=>{
	const left=inputController(),right=inputController(128),routed=createRoutedRecordingController([left,right].map(input=>({kind:'device',controller:input.controller,disconnected:false,stopped:false})));
	routed.start();routed.pause();assert.ok(routed.resumeConfirmed);assert.deepEqual(await routed.resumeConfirmed({startFrame:1000}),{startFrame:1128});
	assert.deepEqual(left.frames,[1000,1128]);assert.deepEqual(right.frames,[1000]);assert.equal(routed.state,'recording');await routed.stop();
});

test('a routed Resume rejection retires every partially scheduled input',async()=>{
	const error=new Error('Input ended'),left=inputController(),right=inputController(0,error),routed=createRoutedRecordingController([left,right].map(input=>({kind:'device',controller:input.controller,disconnected:false,stopped:false})));
	routed.start();routed.pause();assert.ok(routed.resumeConfirmed);await assert.rejects(routed.resumeConfirmed({startFrame:1000}),error);assert.equal(left.state(),'stopped');assert.equal(right.state(),'stopped');
});

test('confirmed Resume keeps the old sound-activation Pause flush and then opens a new frame epoch',async()=>{
	const source=inputController(),flush: {complete?:()=>void}={},states:string[]=[];
	const session=createSoundActivatedRecordingCaptureSession({getSettings:()=>({thresholdDb:-40,hysteresisDb:6,holdFrames:12000}),setState:(_source,state)=>{states.push(state);}},
		{sourceKey:'device:mic',kind:'device',sampleRate:48000,channelCount:1},()=>true);
	const wrapped=session.wrapController({...source.controller,pauseAfterFlush:complete=>{flush.complete=complete;return source.controller.pause();}});
	wrapped.start({startFrame:0});session.process({frameStart:0,frames:128,channels:[new Float32Array(128).fill(.25)]});
	wrapped.pause();assert.ok(wrapped.resumeConfirmed);await wrapped.resumeConfirmed({startFrame:1000});
	assert.equal(session.process({frameStart:128,frames:128,channels:[new Float32Array(128).fill(.125)]})[0]?.frames,128);
	assert.ok(flush.complete);flush.complete();assert.equal(session.process({frameStart:1000,frames:128,channels:[new Float32Array(128).fill(.5)]})[0]?.frames,128);
	assert.notEqual(states.at(-1),'cancelled');await wrapped.stop();
});

test('a canceled sound-activation session cannot reopen after a late Resume confirmation',async()=>{
	const source=inputController(),ready=deferred<void>();
	const session=createSoundActivatedRecordingCaptureSession({getSettings:()=>({thresholdDb:-40,hysteresisDb:6,holdFrames:12000}),setState(){}},
		{sourceKey:'device:mic',kind:'device',sampleRate:48000,channelCount:1},()=>true);
	const wrapped=session.wrapController({...source.controller,async resumeConfirmed({startFrame}){await ready.promise;return{startFrame};}});
	wrapped.start({startFrame:0});wrapped.pause();assert.ok(wrapped.resumeConfirmed);const pending=wrapped.resumeConfirmed({startFrame:1000});session.cancel();ready.resolve();await assert.rejects(pending,{name:'AbortError'});assert.equal(session.state,'cancelled');
});

test('a late routed confirmation cannot publish recording after Stop',async()=>{
	const input=inputController(),ready=deferred<void>(),routed=createRoutedRecordingController([{kind:'device',controller:{...input.controller,async resumeConfirmed({startFrame}){await ready.promise;return{startFrame};}},disconnected:false,stopped:false}]);
	routed.start();routed.pause();assert.ok(routed.resumeConfirmed);const pending=routed.resumeConfirmed({startFrame:1000});await routed.stop();ready.resolve();await assert.rejects(pending,{name:'AbortError'});assert.equal(routed.state,'stopped');
});
