/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { decodeImportedVideoAudio } from '../src/common/editor/controller/import/internal/video-import-audio-decode.ts';
import { videoRetimePreviewMedia } from './browser/fixtures/video-retime-preview-media.js';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { enabledVideoAudioTrackFixture, quickTimePcmTailFixture, quickTimePcmTailS16Sha256 } from './helpers/native-video-audio-tail-fixture.ts';

function fixture(hasAudio?: boolean) {
	const calls: string[] = [];
	const decoded = { channels: [new Float32Array([0.25])], sampleRate: 48000 };
	const options = {
		file: new Blob([new Uint8Array(4)]), projectSampleRate: 44100, durationSeconds: 1, hasAudio,
		inspectEncodedSampleRate() { calls.push('inspect'); return 48000; },
		decodeNative() { calls.push('native'); return Promise.resolve(decoded); },
		decodeContainerAudio() { calls.push('container'); return Promise.resolve(decoded); },
		decodeFfmpeg() { calls.push('ffmpeg'); return Promise.resolve(decoded); },
	};
	return { options, calls, decoded };
}

test('a confirmed silent video bypasses every audio decoder', async () => {
	const { options, calls } = fixture(false);
	const result = await decodeImportedVideoAudio(options);
	assert.deepEqual(calls, []);
	assert.deepEqual(result, { decodedAudio: { channels: [], sampleRate: 44100 }, declaredAudioSampleRate: null });
});

test('a QuickTime signed-16 PCM programme retains its full decoded audio beyond picture', async () => {
	const file = new File([quickTimePcmTailFixture()], 'Camera.mov', { type: 'video/quicktime' });
	const { decodedAudio, programmeFrameCount } = await decodeImportedVideoAudio({
		file, projectSampleRate: 48_000, durationSeconds: .8, hasAudio: true,
		inspectEncodedSampleRate: () => 48_000,
		decodeNative: async () => { throw new Error('Use the timestamped container decoder.'); },
		decodeFfmpeg: async () => { throw new Error('The PCM fixture does not require a codec fallback.'); },
	});
	assert.equal(programmeFrameCount, 57_600);
	assert.equal(decodedAudio.sampleRate, 48_000);
	assert.equal(decodedAudio.channels?.length, 1);
	const plane = decodedAudio.channels[0]!;
	assert.equal(plane.length, 57_600);
	const signed = Buffer.alloc(plane.length * 2);
	for (const [frame, value] of plane.entries()) signed.writeInt16LE(Math.round(value * 32768), frame * 2);
	assert.equal(createHash('sha256').update(signed).digest('hex'), quickTimePcmTailS16Sha256);
});

test('an explicitly enabled AAC programme prevents fallback to a different stream', async () => {
	const { options, calls } = fixture(true);
	const file = new File([enabledVideoAudioTrackFixture()], 'Two programmes.mp4', { type: 'video/mp4' });
	const unavailable = new Error('The selected packet decoder is unavailable.');
	const { BlobSource, Input, MP4 } = await import('mediabunny');
	async function assertIsolated(blob: Blob): Promise<void> {
		const input = new Input({ source: new BlobSource(blob), formats: [MP4] });
		try { assert.deepEqual((await input.getAudioTracks()).map(track => track.id), [3]); }
		finally { input.dispose(); }
	}
	const decoded: string[] = [];
	await assert.rejects(decodeImportedVideoAudio({
		...options, file, durationSeconds: .8, projectSampleRate: 48_000,
		async decodeNative(encoded) { await assertIsolated(new Blob([encoded])); decoded.push('native'); throw unavailable; },
		async decodeContainerAudio(blob) { await assertIsolated(blob); decoded.push('container'); throw unavailable; },
		async decodeFfmpeg(blob) { await assertIsolated(blob); decoded.push('ffmpeg'); throw unavailable; },
	}), error => error === unavailable);
	assert.deepEqual(calls, []);
	assert.deepEqual(decoded, ['native', 'container', 'ffmpeg']);
	await decodeImportedVideoAudio({ ...options, file, durationSeconds: .8, projectSampleRate: 48_000, audioProgramme: 'legacy' });
	assert.deepEqual(calls, ['native']);
});

for (const hasAudio of [true, undefined]) {
	test(`audio inventory ${String(hasAudio)} retains native decoding`, async () => {
		const { options, calls, decoded } = fixture(hasAudio);
		assert.equal((await decodeImportedVideoAudio(options)).decodedAudio, decoded);
		assert.deepEqual(calls, ['inspect', 'native']);
	});
}

test('a stalled whole-file native decode yields to the container decoder', { timeout: 3_000 }, async (context) => {
	const { options, calls, decoded } = fixture(true);
	const started = deferred<void>();
	const native = deferred<typeof decoded>();
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const importing = decodeImportedVideoAudio({ ...options, decodeNative() {
		calls.push('native'); started.resolve(); return native.promise;
	} });
	await started.promise;
	context.mock.timers.tick(14_999);
	assert.ok(await remainsPending(importing));
	assert.deepEqual(calls, ['inspect', 'native']);
	context.mock.timers.tick(1);
	assert.equal((await importing).decodedAudio, decoded);
	assert.deepEqual(calls, ['inspect', 'native', 'container']);
	native.reject(new Error('Native decoder rejected after the deadline.'));
});

test('cancelling a stalled native decode stops before fallback', { timeout: 3_000 }, async () => {
	const { options, calls } = fixture(true);
	const started = deferred<void>();
	const abort = new AbortController();
	const importing = decodeImportedVideoAudio({ ...options, signal: abort.signal, decodeNative() {
		calls.push('native'); started.resolve(); return new Promise(() => {});
	} });
	await started.promise;
	abort.abort();
	await assert.rejects(importing, { name: 'AbortError' });
	assert.deepEqual(calls, ['inspect', 'native']);
});

test('an already cancelled silent import does not report success', async () => {
	const { options, calls } = fixture(false);
	await assert.rejects(decodeImportedVideoAudio({ ...options, signal: AbortSignal.abort() }), { name: 'AbortError' });
	assert.deepEqual(calls, []);
});

test('large video audio uses container slices without materializing the encoded file', async () => {
	const { options, calls, decoded } = fixture(true);
	options.file = new class extends Blob {
		override get size() { return 7 * 1024 ** 3; }
		override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('Whole-file read is forbidden'); }
	}();
	assert.equal((await decodeImportedVideoAudio(options)).decodedAudio, decoded);
	assert.deepEqual(calls, ['container']);
});

test('an unreported inventory is recovered from the silent MP4 container', async () => {
	const { options, calls } = fixture();
	options.file = new Blob([videoRetimePreviewMedia.file.buffer], { type: 'video/mp4' });
	const result = await decodeImportedVideoAudio(options);
	assert.deepEqual(calls, []);
	assert.deepEqual(result.decodedAudio.channels, []);
});
