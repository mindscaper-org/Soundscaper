/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLegacyRecordingCaptureService } from '../src/common/editor/controller/recording/internal/legacy-recording-capture-service.ts';
import { createRoutedRecordingCaptureService } from '../src/common/editor/controller/recording/internal/routed-recording-capture-service.ts';
import { createSoundActivationTimestampCommands } from '../src/common/editor/controller/recording/internal/sound-activation/sound-activation-timestamp-labels.ts';
import { createRecordingCaptureFixture, createScope } from './fixtures/recording-capture-fixture.ts';

for (const kind of ['ordinary', 'routed'] as const) test(`${kind} sound-activated timestamp labels retain capture time when durable writes delay chunk handling`, async context => {
	const fixture = createRecordingCaptureFixture({ streamChannelCount: 1, soundActivationSettings: { thresholdDb: -20, hysteresisDb: 0, holdFrames: 0 } });
	fixture.state.recordingRouting = { routes: { 'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 } }, offsets: {} };
	let nowMs = 1000;
	context.mock.method(Date, 'now', () => nowMs);
	const audioContext = { sampleRate: 48_000, currentTime: 4, async resume() {} };
	const runtime = { ...fixture.runtime, currentTimeMs: () => nowMs,
		engine: { ...fixture.runtime.engine, getAudioContext: async () => audioContext },
		soundActivation: { ...fixture.runtime.soundActivation!, getAddTimestamps: () => true },
	};
	if (kind === 'ordinary') await createLegacyRecordingCaptureService(runtime).capture({ trackId: 'track-1' }, createScope(() => true));
	else await createRoutedRecordingCaptureService(runtime).capture({ trackId: 'track-1' }, createScope(() => true));
	const startFrame = fixture.recorderStartOptions[0]?.startFrame;
	assert.equal(startFrame, 204_000);
	const recorder = fixture.recorderOptions();
	assert.ok(recorder);
	const channels = [new Float32Array(480)]; channels[0]![0] = .5;
	// The capture queue handles old messages after a preceding storage ACK.
	nowMs = 3000; audioContext.currentTime = 6;
	await recorder.onChunk({ frameStart: startFrame!, frames: 480, channels });
	nowMs = 6000; audioContext.currentTime = 9;
	await recorder.onChunk({ frameStart: startFrame! + 480, frames: 480, channels });
	const preview = kind === 'ordinary' ? fixture.state.recordingPreview : fixture.state.recordingPreviews[0];
	assert.ok(preview);
	assert.deepEqual(preview.activationTimestamps, [
		{ offsetFrames: 0, occurredAtMs: 1250 }, { offsetFrames: 1, occurredAtMs: 1260 },
	]);
	let ids = 0;
	const commands = createSoundActivationTimestampCommands({ project: fixture.project, projectSampleRate: 48_000,
		labelTrackName: 'Labels', createId: prefix => `${prefix}-${++ids}`,
		timestamps: preview.activationTimestamps!.map(timestamp => ({ ...timestamp, startFrame: preview.startFrame, sampleRate: 48_000 })),
	});
	assert.deepEqual(commands.flatMap(command => command.type === 'label/add' ? [Date.parse(String(command.label.title))] : []), [1250, 1260]);
});
