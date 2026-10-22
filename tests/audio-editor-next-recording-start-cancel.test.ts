/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createRecordingSessionService } from '../src/common/editor/controller/recording/internal/recording-session-service.ts';
import { createLegacyRecordingCaptureService } from '../src/common/editor/controller/recording/internal/legacy-recording-capture-service.ts';
import { createRoutedRecordingCaptureService } from '../src/common/editor/controller/recording/internal/routed-recording-capture-service.ts';
import { createStorageCapacityService } from '../src/common/editor/controller/shared/storage-capacity-service.ts';
import { createRecordingCaptureFixture, deferred } from './fixtures/recording-capture-fixture.ts';

for (const routed of [false, true]) test(`Stop drains a ${routed ? 'routed' : 'default'} recording preflight without waiting for native storage`, async () => {
	const fixture = createRecordingCaptureFixture();
	if (routed) fixture.state.recordingRouting = { routes: { 'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 } }, offsets: {} };
	const held = deferred<Readonly<{ usage: number; quota: number }>>();
	const estimating = deferred<void>();
	let estimates = 0;
	const capacity = createStorageCapacityService({ estimateStorage() {
		estimates++;
		if (estimates === 1) { estimating.resolve(); return held.promise; }
		return { usage: 0, quota: 2 ** 30 };
	}, isInactive: () => false, setSnapshot() {}, publish() {}, copy: {
		storageOperationRecording: 'Recording', storageOperationExport: 'Export', storageOperationEffect: 'Effect',
		storageOperationProject: 'Project', storageOperationImport: 'Import', insufficientStorage: '{operation}: {required}',
		formatBytes: String,
	} });
	const runtime = { ...fixture.runtime, preflightStorage: capacity.preflightStorage };
	const capture = routed ? createRoutedRecordingCaptureService(runtime) : createLegacyRecordingCaptureService(runtime);
	const service = createRecordingSessionService({ state: fixture.state, getProjectId: () => fixture.project.id,
		beginRecording: (options, scope) => capture.capture(options, scope),
		performLegacyFinalization: async () => {}, performRoutedFinalization: async () => {},
		releaseUnretainedRecordingInputs: fixture.runtime.releaseUnretainedRecordingInputs });
	const first = service.startRecording({ trackId: 'track-1' });
	assert.ok(first);
	try {
		await estimating.promise;
		await service.stopRecording();
		assert.equal(fixture.state.recordingStarting, false);
		await Promise.race([first, delay(1000).then(() => { throw new Error('Stop must retire recording preparation before the canceled native estimate returns'); })]);
		assert.equal(fixture.state.recordingStartPromise, null);
		assert.equal(fixture.recorderCreations(), 0);
		await service.startRecording({ trackId: 'track-1' });
		const recorder = fixture.state.recorder;
		assert.ok(recorder);
		assert.equal(estimates, 2);
		const releasedBeforeOldEstimate = fixture.releases();
		held.resolve({ usage: 2 ** 30, quota: 2 ** 30 });
		await Promise.resolve(); await Promise.resolve();
		assert.strictEqual(fixture.state.recorder, recorder);
		assert.equal(fixture.releases(), releasedBeforeOldEstimate, 'a late canceled preflight cannot release the new take inputs');
	} finally { held.resolve({ usage: 0, quota: 2 ** 30 }); await first; await fixture.state.recorder?.dispose?.(); }
});
