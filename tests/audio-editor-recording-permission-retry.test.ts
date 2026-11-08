/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createRecordingCapturePool } from '../src/common/editor/recording-capture-pool.js';
import { createAudioEditorController, createMockStream, createMockTrack, createProjectStore,
	createRecordingControllerFactory, createRecordingEngine, createFfmpegStub } from './helpers/audio-editor-recording-controller-harness.js';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';
import type { RecordingControllerFactoryOptions } from '../src/common/editor/controller/recording/recording-transaction-types.ts';

for (const [source, retain] of [['default', false], ['usb', false], ['display', false], ['default', true]] as const) test(`${source} ${retain ? 'retained' : 'unretained'} Record retry owns its pending native permission grant`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const firstAudio = createMockTrack('audio', { channelCount: 2 }), secondAudio = createMockTrack('audio', { channelCount: 2 });
	const firstVideo = createMockTrack('video'), secondVideo = createMockTrack('video');
	const oldStream = createMockStream(source === 'display' ? [firstAudio, firstVideo] : [firstAudio]);
	const newStream = createMockStream(source === 'display' ? [secondAudio, secondVideo] : [secondAudio]);
	const oldPermission = deferred<typeof oldStream>(), newPermission = deferred<typeof newStream>();
	let permissions = 0, held = false;
	const request = () => !held ? Promise.resolve(createMockStream(source === 'display'
		? [createMockTrack('audio', { channelCount: 2 }), createMockTrack('video')] : [createMockTrack('audio', { channelCount: 2 })]))
		: ++permissions === 1 ? oldPermission.promise : newPermission.promise;
	const pool = createRecordingCapturePool({ requestHardwareInput: request, requestDisplayInput: request });
	const created: RecordingControllerFactoryOptions[] = [];
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', projectRuntime: runtime,
		sessionController: runtime.createSessionController(), store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: createRecordingEngine() as unknown as Options['engine'], ffmpeg: createFfmpegStub() as unknown as Options['ffmpeg'],
		recordingCapturePool: pool as unknown as Options['recordingCapturePool'], recordingControllerFactory: createRecordingControllerFactory(created),
		mediaDevices: { async getUserMedia() { return newStream; }, async getDisplayMedia() { return newStream; }, async enumerateDevices() {
			return [{ kind: 'audioinput', deviceId: 'default', label: 'Default microphone' }, { kind: 'audioinput', deviceId: 'usb', label: 'USB microphone' }];
		} } as unknown as Options['mediaDevices'],
	});
	context.after(async () => { oldPermission.resolve(oldStream); newPermission.resolve(newStream); await controller.actions.recording.stop(); await controller.dispose(); });
	await controller.ready;
	const trackId = controller.getSnapshot().project?.tracks?.[0]?.id; assert.ok(typeof trackId === 'string');
	if (source !== 'default') await controller.actions.recording.setTrackInput(trackId, source === 'display'
		? { kind: 'display', channelStart: 0, channelCount: 1 }
		: { kind: 'device', deviceId: source, channelStart: 0, channelCount: 1 });
	await controller.actions.recording.setRetainInputs(retain); controller.actions.recording.releaseInputs(); held = true;
	const first = controller.actions.recording.start({ trackId }); const firstResult = Promise.allSettled([first]);
	await waitFor(() => permissions === 1 && controller.getSnapshot().recordingStarting, 'first native input permission');
	await controller.actions.transport.stop();
	assert.equal(controller.getSnapshot().recordingStarting, false);
	let retrySettled = false;
	const retry = controller.actions.recording.start({ trackId });
	const retryResult = Promise.allSettled([retry]).then(outcomes => { retrySettled = true; return outcomes; });
	await settle(); const permissionCallsBeforeOldGrant = permissions;
	if (retain) oldPermission.resolve(oldStream); else newPermission.resolve(newStream);
	await waitFor(() => retrySettled || controller.getSnapshot().recording, 'retry capture after its permission grant');
	const recordingAfterIntendedGrant = controller.getSnapshot().recording;
	oldPermission.resolve(oldStream);
	const [[firstOutcome], [retryOutcome]] = await Promise.all([firstResult, retryResult]); await settle();
	assert.equal(permissionCallsBeforeOldGrant, retain ? 1 : 2, 'retention coalesces permission; unretained retries own a fresh request');
	assert.equal(retryOutcome?.status, 'fulfilled', retryOutcome?.status === 'rejected' ? String(retryOutcome.reason) : 'retry completed');
	assert.equal(recordingAfterIntendedGrant, true, retain ? 'the retry adopts the retained grant' : 'the canceled native grant cannot hold the new Record intent');
	assert.equal(firstOutcome?.status, 'fulfilled', 'existing capture cancellation stays quiet');
	assert.equal(created.length, 1);
	assert.equal(firstAudio.readyState, retain ? 'live' : 'ended');
	assert.strictEqual(source === 'display' ? pool.getDisplay() : pool.getHardware(source), retain ? oldStream : newStream);
	assert.equal(controller.getSnapshot().recording, true, 'late old cleanup cannot stop the retry');
});
