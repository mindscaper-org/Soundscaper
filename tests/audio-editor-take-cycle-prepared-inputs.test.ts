/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireTakeCycleRoutedSources } from '../src/common/editor/controller/recording/internal/take-cycle/take-cycle-routed-source-acquisition.ts';
import type { RecordingRoute, RecordingTrack } from '../src/common/editor/controller/recording/recording-transaction-types.ts';

test('cycle capture keeps surviving staged inputs without prompting a declined source again', async () => {
	const stream = { getAudioTracks: () => [] };
	const track: RecordingTrack = { id: 'mic', type: 'audio', armed: true };
	const mic: RecordingRoute = { kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 1 };
	const display: RecordingRoute = { kind: 'display', channelStart: 0, channelCount: 1 };
	const failures: string[] = [];
	const sources = await acquireTakeCycleRoutedSources([
		{ sourceKey: 'device:default', routes: [{ track, route: mic }] },
		{ sourceKey: 'display', routes: [{ track: { ...track, id: 'screen' }, route: display }] },
	], 48_000, {
		capturePool: { getHardware: () => stream, getDisplay: () => null,
			async acquireHardware() { assert.fail('prepared hardware must be reused'); },
			async acquireDisplay() { assert.fail('declined display must not prompt outside the initiating gesture'); } },
		recordingStreamIsLive: () => true, streamAudioChannelCount: () => 1,
	}, async ({ track: failed }) => { failures.push(failed.id); }, true);
	assert.equal(sources.length, 1); assert.strictEqual(sources[0]?.stream, stream);
	assert.deepEqual(failures, ['screen']);
});
