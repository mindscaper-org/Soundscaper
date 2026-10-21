/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoutedRecordingCaptureService } from '../src/common/editor/controller/recording/internal/routed-recording-capture-service.ts';
import { createRecordingCaptureFixture, createScope } from './fixtures/recording-capture-fixture.ts';

for (const assigned of [[2], [2, 3]]) test(`sound activation ignores unused hardware channels while sharing assigned inputs ${assigned.map(index => index + 1).join(',')}`, async () => {
	const fixture = createRecordingCaptureFixture({ streamChannelCount: 4,
		soundActivationSettings: { thresholdDb: -20, hysteresisDb: 0, holdFrames: 0 },
	});
	fixture.state.recordingRouting = { routes: Object.fromEntries(assigned.map((channelStart, index) => [
		`track-${index + 1}`, { kind: 'device' as const, deviceId: 'mic', channelStart, channelCount: 1 },
	])), offsets: {} };
	await createRoutedRecordingCaptureService(fixture.runtime).capture({}, createScope(() => true));
	const recorder = fixture.recorderOptionsList[0];
	assert.ok(recorder);
	const start = fixture.recorderStartOptions[0]?.startFrame;
	assert.equal(start, 204_000);
	const unused = Array.from({ length: 4 }, () => new Float32Array(3));
	unused[0]!.fill(.5);
	await recorder.onChunk({ frameStart: start!, frames: 3, channels: unused });
	assert.equal(fixture.writerRecords.every(record => record.writer.framesWritten === 0), true,
		'an unassigned microphone cannot start persistence of silent assigned inputs');
	const selected = Array.from({ length: 4 }, () => new Float32Array(3));
	selected[assigned.at(-1)!]!.set([.5, 0, .25]);
	await recorder.onChunk({ frameStart: start! + 3, frames: 3, channels: selected });
	assert.equal(fixture.writerRecords.every(record => record.writer.framesWritten === 2), true);
	for (const [index, record] of fixture.writerRecords.entries()) {
		assert.deepEqual(record.writes.map(channels => [...channels[0]!]), [index === assigned.length - 1 ? [.5, .25] : [0, 0]]);
	}
	assert.equal(fixture.recorderCreations(), 1);
});
