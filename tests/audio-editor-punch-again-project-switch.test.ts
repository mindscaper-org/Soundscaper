/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { RecordingControllerFactoryOptions } from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import {
	createAudioEditorController, createCapturePool, createFfmpegStub, createMockStream,
	createMockTrack, createProjectStore, createRecordingControllerFactory, createRecordingEngine,
} from './helpers/audio-editor-recording-controller-harness.js';

test('switching away from a recorded project retires its old Punch Again target', async () => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'punch-project-switch' });
	const created: RecordingControllerFactoryOptions[] = [];
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, { store,
		engine: createRecordingEngine() as unknown as Options['engine'], ffmpeg: createFfmpegStub() as unknown as Options['ffmpeg'],
		recordingCapturePool: createCapturePool({ hardware: { default: () => createMockStream([createMockTrack('audio', { channelCount: 1 })]) } }) as unknown as Options['recordingCapturePool'],
		recordingControllerFactory: createRecordingControllerFactory(created) });
	try {
		await controller.ready;
		const project = controller.getSnapshot().project!;
		const trackId = project.tracks?.[0]?.id;
		assert.ok(trackId);
		await controller.actions.recording.start({ trackId });
		await created[0]!.onChunk({ frameStart: 0, frames: 4096, channels: [new Float32Array(4096).fill(.25)] });
		await controller.actions.recording.stop();
		assert.equal(controller.getSnapshot().recordingOptions.canPunchAgain, true);
		await controller.actions.project.create();
		await controller.actions.project.openById(project.id);
		assert.equal(controller.getSnapshot().project!.clips.length, 1);
		assert.equal(controller.getSnapshot().recordingOptions.canPunchAgain, false,
			'the original recording belongs to an earlier project activation');
		assert.equal(await controller.actions.recording.punchAgain(), false);
		assert.equal(created.length, 1);
	} finally { await controller.dispose(); }
});
