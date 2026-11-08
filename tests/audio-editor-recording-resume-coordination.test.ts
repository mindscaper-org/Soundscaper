/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecordingSessionService, type RecordingControllerLike, type RecordingSessionMutableState } from '../src/common/editor/controller/recording/internal/recording-session-service.ts';
import { recordingResumeTiming } from '../src/common/editor/controller/recording/internal/recording-start-timing.ts';
import { confirmClockedPlaybackStart } from '../src/common/editor/engine/clocked-playback-start.ts';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';
import { MidiPreviewContext, midiPreviewEngine } from './helpers/midi-preview-context.ts';

function fixture(latency = 4800, sampleRate = 48000) {
	const ready = deferred<void>(), native = deferred<void>(), context = { currentTime: 1, sampleRate };
	let projectId = 'project', backing = 'playing', input = 'recording', playCalls = 0, pauseCalls = 0, disposed = false;
	let holdNative = false, playbackError: Error | null = null, nativeError: Error | null = null;
	const scheduled: number[] = [], immediate: string[] = [], audible: number[] = [];
	const recorder: RecordingControllerLike = { get state() { return input; },
		pause() { if(input!=='recording')return false;input='paused';return true; },
		resume() { immediate.push('resume');input='recording';return true; },
		async resumeConfirmed({startFrame}) { scheduled.push(startFrame);if(nativeError)throw nativeError;if(holdNative)await native.promise;input='recording';return {startFrame}; },
		stop() { input='stopped'; }
	};
	const state: RecordingSessionMutableState = { readOnly:false,get disposed(){return disposed;},projectBinPreview:null,recorder,recordingKind:'ordinary',
		recordingStarting:false,recordingStartGeneration:1,recordingStartPromise:null,timedRecordingPreparing:false,timedRecording:null,activeTimedRecording:null,
		recordingPaused:false,leadInRecording:false,recordingEntries:null,recordingWriter:null,recordingStream:null,recordingSourceId:null,recordingTrackId:null,
		recordingStartFrame:0,recordingSelection:null,recordingResampler:null,recordingSampleRate:sampleRate,recordingSourceOffsetFrames:0,
		recordingPreview:null,recordingPreviews:[],recordingPreviewLastPublishedAt:0,recordingCleanup:null,recordingFinishing:false,recordingFinalizePromise:null,
		recordingFatalError:null,recordingDiscardRequested:false,recordingReleaseAfterStop:false,inputMeterDb:-60,inputMeters:{} };
	const abort = new AbortController();
	const service = createRecordingSessionService({state,getProjectId:()=>projectId,beginRecording:async()=>{},performLegacyFinalization:async()=>{},performRoutedFinalization:async()=>{},
		signal:abort.signal,getTransportState:()=>backing,getTransportLatencyFrames:()=>latency,getTransportContext:async()=>context,
		pauseTransport:()=>{backing='paused';pauseCalls++;},
		playTransport:hook=>{playCalls++;if(!hook){backing='playing';return;}return(async()=>{await ready.promise;if(playbackError)throw playbackError;const time=await hook(1.08);audible.push(time);backing='playing';})();},
		updateTransportState:()=>{}
	});
	assert.equal(service.toggleRecordingPause(),true);
	return {state,service,ready,native,scheduled,immediate,audible,context,abort,
		playCalls:()=>playCalls,pauseCalls:()=>pauseCalls,input:()=>input,backing:()=>backing,dispose:()=>{disposed=true;abort.abort();},
		setProject:(value:string)=>{projectId=value;},setBacking:(value:string)=>{backing=value;},setLatency:(value:number)=>{latency=value;},
		holdNative:()=>{holdNative=true;},failPlayback:(error:Error)=>{playbackError=error;},failNative:(error:Error)=>{nativeError=error;}
	};
}

test('Resume waits for the current graph and schedules input on its audible native frame',async()=>{
	const f=fixture();const pending=f.service.toggleRecordingPause();await settle();
	assert.equal(f.state.recordingPaused,true);assert.deepEqual(f.immediate,[]);assert.deepEqual(f.scheduled,[]);
	f.ready.resolve();assert.equal(await pending,false);assert.equal(f.scheduled.length,1);assert.ok(f.scheduled[0]!>=56640&&f.scheduled[0]!<=56641);
	assert.equal(f.audible[0],(f.scheduled[0]!-4800)/48000);assert.equal(f.state.recordingPaused,false);
});

test('Resume uses the new graph PDC and context rate rather than the disposed graph hint or project clock',async()=>{
	const f=fixture(4800,96000);f.setLatency(9600);const pending=f.service.toggleRecordingPause();f.ready.resolve();await pending;
	assert.equal(f.scheduled.length,1);assert.ok(f.scheduled[0]!>=113280&&f.scheduled[0]!<=113281);assert.equal(f.audible[0],(f.scheduled[0]!-9600)/96000);
});

test('zero-PDC Resume retains the synchronous capture path',()=>{
	const f=fixture(0);assert.equal(f.service.toggleRecordingPause(),false);assert.deepEqual(f.immediate,['resume']);assert.deepEqual(f.scheduled,[]);assert.equal(f.playCalls(),1);
});

test('a completed backing programme does not restart or delay resumed microphone capture',()=>{
	const f=fixture();f.setBacking('stopped');assert.equal(f.service.toggleRecordingPause(),false);assert.deepEqual(f.immediate,['resume']);assert.equal(f.playCalls(),0);
});

test('repeated Resume joins the same pending intent without scheduling a second backing run',async()=>{
	const f=fixture();const first=f.service.toggleRecordingPause(),second=f.service.toggleRecordingPause();assert.equal(first,second);f.ready.resolve();await first;assert.equal(f.playCalls(),1);assert.equal(f.scheduled.length,1);
});

for(const action of ['stop','project','recorder','dispose'] as const)test(`${action} retires a pending Resume before playback preparation finishes`,async()=>{
	const f=fixture();const pending=f.service.toggleRecordingPause();await waitFor(()=>f.playCalls()===1,'pending resume graph');
	if(action==='stop')await f.service.stopRecording();
	else if(action==='project')f.setProject('replacement');
	else if(action==='recorder')f.state.recorder={stop(){}};
	else f.dispose();
	f.ready.resolve();await pending;await settle();assert.deepEqual(f.scheduled,[]);assert.deepEqual(f.audible,[]);assert.deepEqual(f.immediate,[]);
});

test('Stop does not wait for an old native acknowledgement and a late acknowledgement cannot restart playback',async()=>{
	const f=fixture();f.holdNative();const pending=f.service.toggleRecordingPause();f.ready.resolve();await waitFor(()=>f.scheduled.length===1,'the pending native resume');
	await f.service.stopRecording();await pending;f.native.resolve();await settle();assert.deepEqual(f.audible,[]);assert.equal(f.state.recorder,null);assert.equal(f.playCalls(),1);
});

for(const failure of ['playback','input'] as const)test(`current ${failure} preparation errors remain visible and leave the take paused`,async()=>{
	const f=fixture(),error=new Error(`${failure} failed`);if(failure==='playback')f.failPlayback(error);else f.failNative(error);
	const pending=f.service.toggleRecordingPause();f.ready.resolve();await assert.rejects(Promise.resolve(pending),error);assert.equal(f.state.recordingPaused,true);assert.deepEqual(f.audible,[]);
});

for (const [sampleRate, block] of [[44100, 29], [48000, 41], [96000, 79]] as const) {
	test(`Resume confirmation preserves its source candidate at ${sampleRate} Hz native quanta`, async t => {
		const native = new MidiPreviewContext({ sampleRate }), engine = midiPreviewEngine(native);
		t.after(() => engine.dispose());
		const context = await engine.getAudioContext({ resume: false });
		const latencyFrames = sampleRate / 10;
		for (const frame of [block * 128, 2 ** 40 + block * 128]) {
			native.currentTime = frame / sampleRate;
			const candidate = context.currentTime + .08;
			const timing = recordingResumeTiming(context, candidate, latencyFrames);
			assert.ok(Number.isSafeInteger(timing.requestedFrame));
			assert.ok(timing.isFuture(timing.requestedFrame));
			const sourceTime = timing.sourceTime(timing.requestedFrame);
			assert.equal(await confirmClockedPlaybackStart(context, candidate, async () => sourceTime), sourceTime);
			assert.ok(sourceTime >= candidate);
			assert.ok(sourceTime - candidate <= 1 / sampleRate);
		}
		assert.throws(() => recordingResumeTiming(context, context.currentTime + .08, Number.MAX_SAFE_INTEGER), RangeError);
	});
}
