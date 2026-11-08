/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireFramescaperCaptureAudioContext } from '../src/common/editor/controller/capture/internal/browser/framescaper-capture-audio-context.ts';
import { createFramescaperBrowserAudioRecorder, type FramescaperWorkletRecordingControllerOptions } from '../src/common/editor/controller/capture/internal/browser/framescaper-browser-audio-recorder.ts';
import { adaptFramescaperRecordingControllerFactory } from '../src/common/editor/controller/capture/framescaper-recording-factory-adapter.ts';
import { MockAudioContext, MockNode, MockParam } from './helpers/mock-audio-context.js';

test('a source-rate capture follows completed speaker changes without replacing its input context', async () => {
	const shared = sharedContext();
	const owned = ownedContext();
	const lease = await acquireFramescaperCaptureAudioContext(shared, 44_100, () => owned);
	assert.equal(lease.context, owned);
	assert.equal(owned.sinkId, 'speakers-a');
	shared.select('speakers-b');
	await settle();
	assert.equal(owned.sinkId, 'speakers-b');
	assert.equal(owned.sampleRate, 44_100);
	assert.equal(owned.closeCount, 0);
	await lease.dispose();
	assert.equal(owned.closeCount, 1);
	assert.equal(shared.listeners.size, 0);
});

test('matching source-rate capture borrows the main output without extra speaker setters or context teardown', async () => {
	const shared = sharedContext();
	const lease = await acquireFramescaperCaptureAudioContext(shared, 48_000, () => { throw new Error('Unexpected context allocation'); });
	shared.select('speakers-b');
	assert.equal(lease.context, shared);
	assert.equal(shared.sinkId, 'speakers-b');
	assert.equal(shared.listeners.size, 0);
	await lease.dispose();
});

for (const failOld of [false, true]) test(`speaker changes during initial capture preparation supersede its ${failOld ? 'failed' : 'successful'} old output`, async () => {
	const shared = sharedContext();
	const initial = deferred();
	const owned = ownedContext(async sinkId => { if (sinkId === 'speakers-a') await initial.promise; });
	const preparing = acquireFramescaperCaptureAudioContext(shared, 44_100, () => owned);
	await settle();
	assert.equal(shared.listeners.size, 1, 'subscribe before awaiting the initial operating-system device change');
	shared.select('speakers-b');
	assert.equal(monitorGain(owned), 0);
	if (failOld) initial.reject(new Error('Old speakers disappeared'));
	else initial.resolve();
	const lease = await preparing;
	assert.deepEqual(owned.calls, ['speakers-a', 'speakers-b']);
	assert.equal(owned.sinkId, 'speakers-b');
	assert.equal(monitorGain(owned), 1);
	await lease.dispose();
});

for (const latest of ['speakers-a', 'speakers-c']) test(`a pending speaker change cannot overwrite the latest ${latest} selection`, async () => {
	const shared = sharedContext();
	const changing = deferred();
	const owned = ownedContext(async sinkId => { if (sinkId === 'speakers-b') await changing.promise; });
	const lease = await acquireFramescaperCaptureAudioContext(shared, 44_100, () => owned);
	shared.select('speakers-b');
	await settle();
	shared.select(latest);
	assert.equal(monitorGain(owned), 0);
	assert.deepEqual(owned.calls, ['speakers-a', 'speakers-b'], 'serialize physical output changes');
	changing.resolve();
	await settle();
	assert.equal(owned.sinkId, latest);
	assert.equal(monitorGain(owned), 1);
	await lease.dispose();
});

test('retirement immediately silences and detaches an owned monitor while a speaker setter is pending', async () => {
	const shared = sharedContext();
	const changing = deferred();
	const warnings: unknown[] = [];
	const owned = ownedContext(async sinkId => { if (sinkId === 'speakers-b') await changing.promise; });
	const lease = await acquireFramescaperCaptureAudioContext(shared, 44_100, () => owned, { onWarning: error => { warnings.push(error); } });
	shared.select('speakers-b');
	await settle();
	await lease.dispose();
	await lease.dispose();
	assert.equal(owned.closeCount, 1);
	assert.equal(shared.listeners.size, 0);
	assert.equal(monitorGain(owned), 0);
	assert.equal(owned.outputs[0]?.disconnected, true);
	shared.select('speakers-c');
	changing.reject(new Error('Retired output failed'));
	await settle();
	assert.deepEqual(owned.calls, ['speakers-a', 'speakers-b']);
	assert.deepEqual(warnings, []);
});

test('a stale failed output is quiet while its current replacement remains gated', async () => {
	const shared = sharedContext();
	const old = deferred();
	const latest = deferred();
	const warnings: unknown[] = [];
	const owned = ownedContext(async sinkId => {
		if (sinkId === 'speakers-b') await old.promise;
		if (sinkId === 'speakers-c') await latest.promise;
	});
	const lease = await acquireFramescaperCaptureAudioContext(shared, 44_100, () => owned, { onWarning: error => { warnings.push(error); } });
	shared.select('speakers-b');
	await settle();
	shared.select('speakers-c');
	old.reject(new Error('Obsolete output failed'));
	await settle();
	assert.equal(monitorGain(owned), 0);
	assert.deepEqual(warnings, []);
	latest.resolve();
	await settle();
	assert.equal(owned.sinkId, 'speakers-c');
	assert.equal(monitorGain(owned), 1);
	await lease.dispose();
});

test('an output failure warns and silences only monitoring while native-rate PCM capture continues', async () => {
	const shared = sharedContext();
	const warning = new Error('Selected speakers are unavailable');
	const warnings: unknown[] = [];
	const failures: unknown[] = [];
	const received: number[][] = [];
	const owned = ownedContext(sinkId => { if (sinkId === 'speakers-b') throw warning; });
	let request: FramescaperWorkletRecordingControllerOptions | undefined;
	const recorder = await createFramescaperBrowserAudioRecorder({
		role: 'microphone', context: shared, createAudioContext: () => owned,
		track: { getSettings: () => ({ sampleRate: 44_100, channelCount: 1 }) }, stream: {},
		monitoring: true, MediaStreamTrackProcessor: null,
		recordingControllerFactory: options => {
			request = options;
			return { start() {}, pause() {}, resume() {}, async stop() {}, async detach() {} };
		},
		onWarning: error => { warnings.push(error); }, onError: error => { failures.push(error); },
		onChunk: chunk => { received.push(Array.from(chunk.channels[0] ?? [])); },
	});
	assert.ok(request);
	assert.equal(request.monitorDestination, owned.outputs[0]);
	await recorder.start();
	await request.onChunk({ frameStart: 0, frames: 3, channels: [Float32Array.of(0.1, 0.2, -0.3)] });
	shared.select('speakers-b');
	await settle();
	assert.deepEqual(warnings, [warning]);
	assert.deepEqual(failures, []);
	assert.equal(monitorGain(owned), 0);
	assert.equal(recorder.state, 'recording');
	assert.equal(recorder.sampleRate, 44_100);
	await request.onChunk({ frameStart: 3, frames: 2, channels: [Float32Array.of(0.4, 0.5)] });
	assert.equal(received.flat().length, 5, 'an unavailable speaker never changes the captured sample count');
	shared.select('speakers-c');
	await settle();
	assert.equal(owned.sinkId, 'speakers-c');
	assert.equal(monitorGain(owned), 1);
	await recorder.dispose();
	assert.equal(owned.closeCount, 1);
});

test('the existing listening volume remains upstream of the context-local speaker gate', async () => {
	const shared = sharedContext();
	const owned = ownedContext();
	const lease = await acquireFramescaperCaptureAudioContext(shared, 44_100, () => owned);
	const factory = adaptFramescaperRecordingControllerFactory(async () => ({
		start() {}, pause() {}, resume() {}, async stop() {}, setMonitoring() {}, setInputGain() {},
	}), { getGain: () => 0.25, subscribe: () => () => {} });
	assert.ok(factory);
	const recorder = await factory({ context: owned, stream: { getAudioTracks: () => [] }, channelCount: 1, chunkFrames: 4_096,
		monitor: true, monitorDestination: lease.monitorDestination, inputGain: 1, maxPendingChunks: 4,
		onChunk() {}, onError() {},
	});
	const speakerGate = owned.outputs[0];
	const listeningGain = owned.outputs[1];
	assert.ok(speakerGate && listeningGain);
	assert.deepEqual(listeningGain.connections, [speakerGate]);
	assert.equal(listeningGain.gain.value, 0.25);
	assert.deepEqual(speakerGate.connections, [owned.destination]);
	await recorder.detach?.();
	await lease.dispose();
});

test('unmonitored source-rate capture subscribes to no output changes', async () => {
	const shared = sharedContext();
	const owned = ownedContext();
	const lease = await acquireFramescaperCaptureAudioContext(shared, 44_100, () => owned, { monitoring: false });
	assert.equal(owned.sinkId, 'speakers-a');
	assert.equal(shared.listeners.size, 0);
	assert.equal(owned.outputs.length, 0);
	shared.select('speakers-b');
	assert.deepEqual(owned.calls, ['speakers-a']);
	await lease.dispose();
});

test('silent sinks keep owned monitoring silent and can return to the default hardware output', async () => {
	const shared = sharedContext();
	const owned = ownedContext();
	const lease = await acquireFramescaperCaptureAudioContext(shared, 44_100, () => owned);
	shared.select({ type: 'none' });
	await settle();
	assert.equal(monitorGain(owned), 0);
	assert.deepEqual(owned.calls, ['speakers-a']);
	shared.select('default');
	await settle();
	assert.equal(owned.sinkId, '');
	assert.equal(monitorGain(owned), 1);
	await lease.dispose();
});

test('an unavailable initial output closes its owned context and releases the shared listener', async () => {
	const shared = sharedContext();
	const owned = ownedContext(() => { throw new Error('Initial output unavailable'); });
	await assert.rejects(acquireFramescaperCaptureAudioContext(shared, 44_100, () => owned), /Initial output unavailable/u);
	assert.equal(owned.closeCount, 1);
	assert.equal(shared.listeners.size, 0);
	assert.equal(owned.outputs[0]?.disconnected, true);
});

test('failed recorder allocation retires the prepared speaker route before later device changes', async () => {
	const shared = sharedContext();
	const owned = ownedContext();
	await assert.rejects(createFramescaperBrowserAudioRecorder({
		role: 'microphone', context: shared, createAudioContext: () => owned,
		track: { getSettings: () => ({ sampleRate: 44_100, channelCount: 1 }) }, stream: {},
		monitoring: true, MediaStreamTrackProcessor: null, onChunk() {},
		recordingControllerFactory() { throw new Error('Microphone recorder allocation failed'); },
	}), /Microphone recorder allocation failed/u);
	assert.equal(owned.closeCount, 1);
	assert.equal(shared.listeners.size, 0);
	assert.equal(monitorGain(owned), 0);
	assert.equal(owned.outputs[0]?.disconnected, true);
	shared.select('speakers-b');
	await settle();
	assert.deepEqual(owned.calls, ['speakers-a']);
});

function sharedContext() {
	const listeners = new Set<() => void>();
	return {
		sampleRate: 48_000, sinkId: 'speakers-a' as string | Readonly<{ type: 'none' }>, listeners,
		addEventListener(type: string, listener: () => void) { assert.equal(type, 'sinkchange'); listeners.add(listener); },
		removeEventListener(type: string, listener: () => void) { assert.equal(type, 'sinkchange'); listeners.delete(listener); },
		select(sinkId: string | Readonly<{ type: 'none' }>) { this.sinkId = sinkId; for (const listener of listeners) listener(); },
	};
}

function ownedContext(beforeSet?: (sinkId: string) => PromiseLike<void> | void) {
	const context = new MockAudioContext({ sampleRate: 44_100 });
	const createGain = () => Object.assign(new MockNode('gain'), { gain: new MockParam(1) });
	const outputs: Array<ReturnType<typeof createGain>> = [];
	return Object.assign(context, {
		sinkId: '', closeCount: 0, calls: [] as string[], outputs,
		createGain() { const output = createGain(); outputs.push(output); return output; },
		async setSinkId(sinkId: string) { this.calls.push(sinkId); await beforeSet?.(sinkId); this.sinkId = sinkId; },
		async resume() {},
		async close() { this.closeCount++; },
	});
}

function monitorGain(context: ReturnType<typeof ownedContext>) {
	const output = context.outputs[0];
	assert.ok(output);
	return output.gain.value;
}

function deferred() {
	let resolve = () => {};
	let reject = (_error: unknown) => {};
	const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

async function settle() { await new Promise<void>(resolve => setImmediate(resolve)); }
