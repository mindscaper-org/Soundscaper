/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoutedRecordingCaptureService } from '../src/common/editor/controller/recording/internal/routed-recording-capture-service.ts';
import { createRecordingCaptureFixture, createScope } from './fixtures/recording-capture-fixture.ts';

for (const enabled of [false, true]) test(`mono desktop audio routed to Right records its audible fallback with sound activation${enabled ? ' on' : ' off'}`, async () => {
	const fixture = createRecordingCaptureFixture({ streamChannelCount: 1,
		soundActivationSettings: enabled ? { thresholdDb: -20, hysteresisDb: 6, holdFrames: 0 } : null });
	fixture.state.recordingRouting = { routes: {
		'track-1': { kind: 'display', channelStart: 1, channelCount: 1 },
	}, offsets: {} };
	await createRoutedRecordingCaptureService(fixture.runtime).capture({ trackId: 'track-1' }, createScope(() => true));
	await fixture.recorderOptionsList[0]!.onChunk({ frameStart: fixture.recorderStartOptions[0]!.startFrame!, frames: 3,
		channels: [Float32Array.of(0, 0.5, 0)] });
	const samples = fixture.writerRecords[0]!.writes.flatMap(channels => [...channels[0]!]);
	assert.deepEqual(samples, enabled ? [0.5] : [0, 0.5, 0]);
	await fixture.state.recorder?.stop();
});
