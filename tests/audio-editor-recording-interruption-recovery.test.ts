/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLegacyRecordingCaptureService } from '../src/common/editor/controller/recording/internal/legacy-recording-capture-service.ts';
import { createRoutedRecordingCaptureService } from '../src/common/editor/controller/recording/internal/routed-recording-capture-service.ts';
import { MediaInputLostError } from '../src/common/editor/controller/shared/media-input-interruption.ts';
import { createRecordingCaptureFixture, createScope, deferred } from './fixtures/recording-capture-fixture.ts';
import type { RecordingMediaStream } from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import { RecordingInputLossError } from '../src/common/editor/recording-input-events.ts';

function input() {
	const events = new EventTarget();
	const track = {
		readyState: 'live', muted: false,
		getSettings: () => ({ channelCount: 1 }),
		addEventListener: (type: string, listener: () => void) => events.addEventListener(type, listener),
		removeEventListener: (type: string, listener: () => void) => events.removeEventListener(type, listener),
	};
	return {
		track,
		stream: { getAudioTracks: () => [track], getTracks: () => [track] },
		emit(type: string) { events.dispatchEvent(new Event(type)); },
	};
}

test('ordinary recording rejects an input lost while its acquisition was pending', async () => {
	const current = input();
	const pending = deferred<RecordingMediaStream>();
	const fixture = createRecordingCaptureFixture({ acquireHardware: () => pending.promise });
	const recording = createLegacyRecordingCaptureService(fixture.runtime).capture({ trackId: 'track-1' }, createScope(() => true));
	current.track.readyState = 'ended'; pending.resolve(current.stream);
	await assert.rejects(recording, MediaInputLostError);
	assert.equal(fixture.recorderCreations(), 0);
	assert.equal(fixture.writerRecords.length, 0);
	assert.equal(fixture.state.recordingStarting, false);
});

test('ordinary recording preserves an explicit loss reason and stops once after active input loss', async () => {
	const current = input();
	const fixture = createRecordingCaptureFixture({ acquireHardware: async () => current.stream });
	await createLegacyRecordingCaptureService(fixture.runtime).capture({ trackId: 'track-1' }, createScope(() => true));
	current.track.readyState = 'ended'; current.emit('ended'); current.emit('ended');
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(fixture.stopCalls(), 1);
	assert.ok(fixture.state.recordingFatalError instanceof MediaInputLostError);
	assert.equal(fixture.writerRecords[0]?.aborts(), 0);
	fixture.state.recordingCleanup?.();
});

test('ordinary recording recovers a live muted track and ignores stale loss after cleanup', async () => {
	const current = input();
	const fixture = createRecordingCaptureFixture({ acquireHardware: async () => current.stream });
	await createLegacyRecordingCaptureService(fixture.runtime).capture({ trackId: 'track-1' }, createScope(() => true));
	current.track.muted = true; current.emit('mute');
	current.track.muted = false; current.emit('unmute');
	assert.equal(fixture.stopCalls(), 0);
	assert.equal(fixture.hardwareRequests(), 1);
	fixture.state.recordingCleanup?.();
	current.track.readyState = 'ended'; current.emit('ended');
	assert.equal(fixture.state.recordingFatalError, null);
});

test('routed recording stops only its lost source and retains the surviving recorder', async () => {
	const first = input(), second = input();
	const fixture = createRecordingCaptureFixture({ reportStoppedOnStop: true });
	fixture.runtime.capturePool.acquireHardware = async deviceId => deviceId === 'first' ? first.stream : second.stream;
	fixture.state.recordingRouting = { routes: {
		'track-1': { kind: 'device', deviceId: 'first', channelStart: 0, channelCount: 1 },
		'track-2': { kind: 'device', deviceId: 'second', channelStart: 0, channelCount: 1 },
	}, offsets: {} };
	await createRoutedRecordingCaptureService(fixture.runtime).capture({}, createScope(() => true));
	fixture.recorderOptionsList[0]!.onError(new RecordingInputLossError());
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(fixture.state.recordingRouteHealth['track-1'], 'disconnected');
	assert.equal(fixture.state.recordingRouteHealth['track-2'], 'recording');
	assert.equal(fixture.finalizeCalls(), 0);
	assert.equal(fixture.writerRecords.every(record => record.aborts() === 0), true);
	assert.ok(fixture.state.recordingFatalError instanceof RecordingInputLossError);
	second.track.readyState = 'ended'; second.emit('ended');
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(fixture.finalizeCalls(), 1);
	fixture.state.recordingCleanup?.();
});

test('a retired routed recorder cannot publish its input-loss failure into a replacement generation', async () => {
	const fixture = createRecordingCaptureFixture();
	fixture.state.recordingRouting = { routes: {
		'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
	}, offsets: {} };
	await createRoutedRecordingCaptureService(fixture.runtime).capture({ trackId: 'track-1' }, createScope(() => true));
	const retainedErrorCallback = fixture.recorderOptionsList[0]!.onError;
	fixture.state.recordingStartGeneration += 1;
	const replacementFailure = new Error('replacement generation');
	fixture.state.recordingFatalError = replacementFailure;
	retainedErrorCallback(new RecordingInputLossError());
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(fixture.state.recordingFatalError, replacementFailure);
	assert.equal(fixture.stopCalls(), 0);
	assert.equal(fixture.state.recordingRouteHealth['track-1'], 'recording');
	fixture.state.recordingCleanup?.();
});
