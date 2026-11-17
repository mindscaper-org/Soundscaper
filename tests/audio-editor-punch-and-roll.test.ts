/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { RecordingControllerFactoryOptions } from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import {
	createAudioEditorController, createCapturePool, createFfmpegStub, createMockStream,
	createMockTrack, createProjectStore, createRecordingControllerFactory, createRecordingEngine,
} from './helpers/audio-editor-recording-controller-harness.js';

for (const mode of ['default', 'routed', 'multitrack']) test(`${mode} Punch Again retains the original point after selection changes`, async () => {
	const routed = mode !== 'default';
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `punch-${mode}` });
	const engine = createRecordingEngine();
	const created: RecordingControllerFactoryOptions[] = [];
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { store,
		engine: engine as unknown as Options['engine'], ffmpeg: createFfmpegStub() as unknown as Options['ffmpeg'],
		recordingCapturePool: createCapturePool({ hardware: { default: () => createMockStream([createMockTrack('audio', { channelCount: mode === 'multitrack' ? 2 : 1 })]) } }) as unknown as Options['recordingCapturePool'],
		recordingControllerFactory: createRecordingControllerFactory(created) });
	try {
		await controller.ready;
		const trackId = controller.getSnapshot().project?.tracks?.[0]?.id;
		assert.ok(typeof trackId === 'string');
		const trackIds = [trackId];
		if (mode === 'multitrack') {
			controller.actions.track.update(trackId, { armed: true });
			const other = controller.actions.track.add({ armed: true });
			assert.ok(other); trackIds.push(other);
		}
		if (routed) for (const id of trackIds) await controller.actions.recording.setTrackInput(id, {
			kind: 'device', deviceId: 'default', channelStart: trackIds.indexOf(id), channelCount: 1 });
		assert.equal(await controller.actions.recording.punchAgain(), false);
		await controller.actions.recording.setLeadInDuration(1);
		controller.actions.recording.toggleLeadIn();
		controller.actions.timeline.clearSelection();
		controller.actions.transport.seek(96_000);
		await controller.actions.recording.start(mode === 'multitrack' ? { multitrack: true } : { trackId });
		assert.equal(engine.getPositionFrames(), 48_000);
		assert.equal(controller.getSnapshot().recordingOptions.canPunchAgain, true);
		const chunk = (amplitude: number) => ({ frameStart: 0, frames: 4_096,
			channels: Array.from({ length: mode === 'multitrack' ? 2 : 1 }, () => new Float32Array(4_096).fill(amplitude)) });
		await created[0]!.onChunk(chunk(.25));
		await controller.actions.recording.stop();
		controller.actions.timeline.setExactSelection(0, 1_024, { trackIds: [trackId] });
		await controller.actions.preferences.update({ recording: { alwaysRecordToNewTrack: true } });
		for (const id of trackIds) controller.actions.track.update(id, { armed: false });
		assert.equal(await controller.actions.recording.punchAgain(), true);
		assert.equal(created.length, 2);
		assert.equal(engine.getPositionFrames(), 48_000);
		await created[1]!.onChunk(chunk(.5));
		await controller.actions.recording.stop();
		const snapshot = controller.getSnapshot();
		assert.equal(snapshot.project?.tracks?.length, trackIds.length, 'retry bypasses the new-track preference');
		const clips = snapshot.project?.clips;
		assert.ok(Array.isArray(clips));
		assert.equal(clips.length, trackIds.length);
		assert.equal(clips[0].timelineStartFrame, 96_000);
		assert.equal(clips[0].durationFrames, 4_096, 'a later selection cannot truncate the retry');
		assert.equal(snapshot.recordingOptions.leadInDurationSeconds, 1);
		assert.equal(await store.loadSetting('recording-lead-in-seconds', null), 1);
	} finally { await controller.dispose(); }
});
