/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BrowserCodecRuntimeDisposedError,
	BrowserCodecRuntimeUnsupportedError,
	createBrowserAudioCodecRuntime,
	type BrowserDedicatedAudioCodecClient,
} from '../src/common/editor/browser-audio-codec-runtime.ts';
import { encodeWav } from '../src/common/editor/wav.js';

test('browser audio runtime deinterleaves dedicated decode bytes and rejects inconsistent geometry', async () => {
	const requests: unknown[] = [];
	const pcm = new Uint8Array(4 * Float32Array.BYTES_PER_ELEMENT);
	const view = new DataView(pcm.buffer);
	for (const [index, sample] of [0.25, -0.25, 0.5, -0.5].entries()) {
		view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, sample, true);
	}
	let malformed = false;
	const client: BrowserDedicatedAudioCodecClient = {
		async encode() { throw new Error('encode was not expected'); },
		async decode(request) {
			requests.push(request);
			return {
				interleaved: pcm,
				frameCount: malformed ? 3 : 2,
				channelCount: 2,
				sampleRate: 48_000,
			};
		},
		dispose() {},
	};
	const runtime = createBrowserAudioCodecRuntime({ codecClient: client, webCodecsAac: false });
	const compressed = new Blob([Uint8Array.of(0x66, 0x4c, 0x61, 0x43, 0)], { type: 'audio/flac' });
	try {
		const decoded = await runtime.decode(compressed);
		assert.deepEqual(decoded.channels.map((channel) => [...channel]), [[0.25, 0.5], [-0.25, -0.5]]);
		assert.equal(decoded.frameCount, 2);
		assert.equal(decoded.sampleRate, 48_000);
		assert.deepEqual(requests, [{
			format: 'flac',
			input: Uint8Array.of(0x66, 0x4c, 0x61, 0x43, 0),
			maximumOutputBytes: 128 * 1024 * 1024,
		}]);
		malformed = true;
		await assert.rejects(runtime.decode(compressed), /inconsistent PCM geometry/u);
	} finally {
		runtime.dispose();
	}
});

test('browser audio preflight proves the exact AAC tuple before render-sized work', async () => {
	const configurations: unknown[] = [];
	const runtime = createBrowserAudioCodecRuntime({
		webCodecsAac: true,
		audioEncoderProbe: {
			async isConfigSupported(configuration) {
				configurations.push(configuration);
				return { supported: true };
			},
		},
	});
	await runtime.preflightEncodeFile('aac-m4a', {
		frameCount: 48_000,
		sampleRate: 48_000,
		inputChannelCount: 2,
		channelMapping: 'stereo',
		bitRate: 192,
		metadata: { title: 'Complete M4A', year: '2026' },
	});
	assert.deepEqual(configurations, [{
		codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 2, bitrate: 192_000, aac: { format: 'aac' },
	}]);
	await runtime.preflightEncodeFile('aac-m4a', {
		frameCount: 48_000, sampleRate: 48_000, bitRate: 192,
		metadata: { copyright: '2026 Owner' },
	});
});

test('browser audio preflight accepts metadata for streamed encoding', async () => {
	const runtime = createBrowserAudioCodecRuntime({
		webCodecsAac: false,
	});
	await runtime.preflightEncodeFile('mp3', {
		frameCount: 48_000, sampleRate: 48_000, inputChannelCount: 2,
		bitRate: 192, metadata: { title: 'Written during packaging' },
	});
	await runtime.preflightEncodeFile('wav', { frameCount: 100 });
});

test('browser audio runtime refuses custom FFmpeg but retains the lazy trim-media lease', async () => {
	const events: string[] = [];
	const runtime = createBrowserAudioCodecRuntime({
		webCodecsAac: false,
		createTrimMediaRuntime: async () => {
			events.push('create');
			return {
				async runTrimMediaOperation(operation) {
					events.push('run');
					return operation({ marker: 'trim-lease' } as never);
				},
				dispose() { events.push('dispose'); },
			};
		},
	});
	assert.equal(events.length, 0, 'constructing the audio runtime must not load FFmpeg');
	const first = await runtime.runTrimMediaOperation(async (lease) => {
		events.push((lease as unknown as { marker: string }).marker);
		return 'trimmed';
	});
	const second = await runtime.runTrimMediaOperation(async () => 'again');
	assert.equal(first, 'trimmed');
	assert.equal(second, 'again');
	assert.deepEqual(events, ['create', 'run', 'trim-lease', 'run']);
	runtime.dispose();
	assert.deepEqual(events, ['create', 'run', 'trim-lease', 'run', 'dispose']);
	await assert.rejects(
		() => runtime.runTrimMediaOperation(async () => 'too late'),
		(error) => error instanceof BrowserCodecRuntimeDisposedError,
	);
});

test('browser audio runtime refuses custom FFmpeg and omits unrelated video capabilities', async () => {
	const runtime = createBrowserAudioCodecRuntime({ webCodecsAac: false });
	const wav = encodeWav([Float32Array.of(0)], { sampleRate: 48_000, bitDepth: 32, float: true });
	await assert.rejects(
		() => runtime.encode(wav, 'custom-ffmpeg'),
		(error) => error instanceof BrowserCodecRuntimeUnsupportedError
			&& error.code === 'BROWSER_CODEC_RUNTIME_UNSUPPORTED',
	);
	for (const operation of [
		'encodeVideo',
		'encodeVideoToSink',
		'probeVideoTiming',
		'conformVideoToCfr',
		'runVideoKeyframeEncoderOperation',
		'runProxyMediaOperation',
	] as const) {
		assert.equal(Object.hasOwn(runtime, operation), false, `${operation} must not advertise a missing capability`);
	}
	assert.equal(typeof runtime.runTrimMediaOperation, 'function');
});
