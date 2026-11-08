/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { RecordingControllerFactoryOptions } from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import type { RecordingRoute } from '../src/common/editor/recording-routing.js';
import {
	createAudioEditorController, createCapturePool, createFfmpegStub,
	createMockStream, createMockTrack, createProjectStore,
	createRecordingControllerFactory, createRecordingEngine,
} from './helpers/audio-editor-recording-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;

for (const multitrack of [false, true]) test(`${multitrack ? 'multi-track' : 'focused'} Record captures successive takes on new tracks with the same input order`, async context => {
	const created: RecordingControllerFactoryOptions[] = [];
	const controller = createAudioEditorController(null, {
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: createRecordingEngine() as unknown as Options['engine'],
		ffmpeg: createFfmpegStub() as unknown as Options['ffmpeg'],
		recordingCapturePool: createCapturePool({ hardware: {
			default: createMockStream([createMockTrack('audio', { channelCount: 2 })]),
		} }) as unknown as Options['recordingCapturePool'],
		recordingControllerFactory: createRecordingControllerFactory(created),
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const original = controller.getSnapshot().project?.tracks?.[0]?.id;
	assert.ok(typeof original === 'string');
	await controller.actions.recording.setTrackInput(original, { kind: 'device', deviceId: 'default', channelStart: 1, channelCount: 1 });
	if (multitrack) {
		const other = controller.actions.track.add({ armed: true });
		assert.ok(other);
		await controller.actions.recording.setTrackInput(other, { kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 1 });
	}
	await controller.actions.preferences.update({ recording: { alwaysRecordToNewTrack: true } });
	// Existing locked media is still usable as an input-assignment template.
	controller.actions.track.update(original, { locked: true });
	const initialTracks = controller.getSnapshot().project?.tracks;
	assert.ok(initialTracks);
	let previousIds = initialTracks.map(track => track.id);
	for (let take = 0; take < 2; take += 1) {
		const focused = take === 0 ? original : previousIds.at(-1);
		await controller.actions.recording.start(multitrack ? {} : { trackId: focused });
		const recording = controller.getSnapshot();
		assert.equal(recording.recording, true);
		const tracks = recording.project?.tracks;
		assert.ok(tracks);
		const newTracks = tracks.filter(track => !previousIds.includes(track.id));
		assert.equal(newTracks.length, multitrack ? 2 : 1);
		const routes = recording.recordingInputs.routes as Readonly<Record<string, RecordingRoute>>;
		assert.deepEqual(newTracks.map(track => routes[track.id]?.channelStart), multitrack ? [1, 0] : [1]);
		await created.at(-1)!.onChunk({ frameStart: 0, frames: 128,
			channels: [new Float32Array(128).fill(0.25), new Float32Array(128).fill(-0.5)] });
		await controller.actions.recording.stop();
		const finished = controller.getSnapshot();
		assert.equal(finished.project!.clips.length, (take + 1) * (multitrack ? 2 : 1));
		for (const track of newTracks) {
			const finishedTrack = finished.project?.tracks?.find(candidate => candidate.id === track.id) as
				{ readonly clipIds: readonly string[] } | undefined;
			assert.equal(finishedTrack?.clipIds.length, 1);
		}
		previousIds = tracks.map(track => track.id);
	}
	const count = previousIds.length;
	await controller.actions.recording.startNewTrack();
	assert.equal(controller.getSnapshot().project?.tracks?.length, count + 1);
	await controller.actions.recording.stop();
});
