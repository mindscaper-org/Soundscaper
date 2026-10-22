/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecordingController } from '../src/common/editor/recording.js';
import {
	acquireSoundscaperNativeAudioCapture,
	claimSoundscaperNativeAudioCapture,
	soundscaperNativeAudioCaptureHasActiveLease,
	soundscaperNativeAudioCaptureSource,
} from '../src/common/editor/soundscaper-native-audio-capture.ts';

test('a native input cannot turn into a silent lifecycle stream when its audio context changes', async () => {
	const fixture = captureFixture();
	try {
		assert.equal(soundscaperNativeAudioCaptureSource(fixture.lease, fixture.context), fixture.node);
		assert.throws(() => soundscaperNativeAudioCaptureSource(fixture.lease, {} as BaseAudioContext), /native audio input.*context/iu);
		let fallbackSources = 0;
		await assert.rejects(() => createRecordingController({ stream: fixture.lease,
			context: { audioWorklet: { async addModule() {} },
				createMediaStreamSource: () => { fallbackSources += 1; return fixture.node; },
			} as unknown as AudioContext,
		} as Parameters<typeof createRecordingController>[0]), /native audio input.*context/iu);
		assert.equal(fallbackSources, 0, 'the recording controller must not capture the silent lifecycle stream');
		fixture.closeContext();
		assert.throws(() => soundscaperNativeAudioCaptureSource(fixture.lease, fixture.context), /native audio input.*closed/iu);
	} finally { fixture.revoke(); }
});

test('revoked and ended native leases never fall through to ordinary MediaStream capture', () => {
	const fixture = captureFixture();
	fixture.revoke();
	assert.throws(() => soundscaperNativeAudioCaptureSource(fixture.lease, fixture.context), /native audio input.*connected/iu);
	const ended = captureFixture();
	try {
		for (const track of ended.lease.getTracks()) track.stop();
		assert.equal(soundscaperNativeAudioCaptureHasActiveLease(), false);
		assert.throws(() => soundscaperNativeAudioCaptureSource(ended.lease, ended.context), /native audio input.*ended/iu);
	} finally { ended.revoke(); }
});

test('ordinary browser streams retain the MediaStream capture path', () => {
	assert.equal(soundscaperNativeAudioCaptureSource({} as MediaStream, {} as BaseAudioContext), null);
});

function captureFixture() {
	const stream = (): MediaStream => {
		const track = { readyState: 'live', stop() { this.readyState = 'ended'; } };
		return { clone: stream, getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
	};
	const context = { state: 'running', createMediaStreamDestination: () => ({ stream: stream() }) };
	const node = { channelCount: 1, channelCountMode: 'max', channelInterpretation: 'speakers' } as unknown as AudioNode;
	const claim = claimSoundscaperNativeAudioCapture({ sessionId: 'capture-lifetime',
		context: context as unknown as AudioContext, node, channelCount: 1, sampleRate: 48_000 });
	claim.activate();
	const lease = acquireSoundscaperNativeAudioCapture({ channelCount: 1, sampleRate: 48_000 });
	assert.ok(lease);
	return { context: context as unknown as AudioContext, node, lease, revoke: claim.revoke,
		closeContext: () => { context.state = 'closed'; } };
}
