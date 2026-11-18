/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeImportedVideoAudio } from '../src/common/editor/controller/import/internal/video-import-audio-decode.ts';
import { videoRetimePreviewMedia } from './browser/fixtures/video-retime-preview-media.js';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

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
