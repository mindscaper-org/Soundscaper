/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { renderAndEncodeAudioExport, type AudioExportRenderOrchestrationRuntime } from '../src/common/editor/controller/export/internal/audio/audio-export-render-orchestration.ts';
import { createRealtimeEncodedAudioExport } from '../src/common/editor/controller/export/internal/audio/audio-realtime-encoded-export.ts';
import { audioBufferChannels, type AudioBufferLike } from '../src/common/editor/controller/source/source-audio.ts';
import type { EngineRealtimeRenderOptions } from '../src/common/editor/engine/public-api.ts';
import { applyMediaChannelMapping, normalizeMediaExportSettings } from '../src/common/editor/media-export.js';
import { createStreamingWindowedSincResampler } from '../src/common/editor/resample.js';
import { encodeWav, createWavStreamEncoder } from '../src/common/editor/wav.js';
import { readWavePcm } from './helpers/read-wave-pcm.ts';

const rate = 48_000;
const captured = [Float32Array.of(.125, .25, .375, .5, .25, .125, 0, 0, .125, .25)];
const expected = [.5, .625, .375, .5];
const sources = { sourceMap: new Map(), chunkSources: null, prepareTimePitchCaches: false };
const signal = new AbortController().signal;
const plan = {
	mode: 'mix', format: 'wav', sampleRate: rate, channelCount: 1, mimeType: 'audio/wav',
	encoding: { ...normalizeMediaExportSettings('wav', { sampleRate: rate, sampleFormat: 'float32', inputChannelCount: 1 }), bitDepth: 32 },
	channelMapping: 'preserve', ditherMode: 'none', metadata: {}, outputFrames: 4,
	range: { startFrame: 100, endFrame: 104, durationFrames: 4 }, tailFrames: 6,
	renderAsLoop: true, render: { strategy: 'offline' },
};

test('offline export wraps tails before resampling and encoding the exact loop extent', async () => {
	let resampled = false;
	const runtime: AudioExportRenderOrchestrationRuntime = {
		encodingRuntime: { copy: { encoding: 'Encoding' }, setStatus() {},
			throwIfAborted: value => value.throwIfAborted(),
			audioBufferChannels: buffer => audioBufferChannels(buffer as AudioBufferLike),
			applyMediaChannelMapping, encodeWav, encodeAiff: () => new Uint8Array(),
			ffmpeg: { encode: () => { throw new Error('WAV never uses FFmpeg'); } },
			resampleBuffer(buffer, sampleRate, _context, _copy, frames) {
				resampled = true;
				assert.deepEqual(Array.from(runtime.encodingRuntime.audioBufferChannels(buffer)[0]!), expected);
				assert.equal(frames, 8);
				const channels = [Float32Array.from({ length: frames }, (_, index) => expected[Math.floor(index / 2)]!)];
				return { sampleRate, length: frames, numberOfChannels: 1, getChannelData: () => channels[0]! };
			},
		},
		normalizeProjectSampleRate: value => value,
		renderRealtimeEncoded: () => { throw new Error('Unexpected fallback'); },
		renderSnapshot(_project, range) {
			assert.equal(range.startFrame, 100); assert.equal(range.endFrame, 104);
			assert.equal(range.preRollFrames, false); assert.equal(range.includeTail, 6 / rate);
			assert.equal(range.outputFrames, 10);
			return { sampleRate: rate, length: 10, numberOfChannels: 1, getChannelData: () => captured[0]!.slice() };
		},
	};
	const output = await renderAndEncodeAudioExport(runtime, {
		plan: { ...plan, sampleRate: rate * 2, outputFrames: 8 }, snapshot: { sampleRate: rate },
		settings: { includeTail: false }, signal, renderSources: sources,
	});
	assert.ok(resampled); assert.ok(output.bytes);
	assert.deepEqual(Array.from(readWavePcm(output.bytes).channels[0]!), expected.flatMap(value => [value, value]));
});

for (const format of ['wav', 'mp3']) test(`streamed ${format} export wraps loop PCM and removes its temporary files`, async () => {
	let removed = 0, disposed = 0;
	const runtime = {
		copy: { encoding: 'Encoding' }, setStatus() {}, throwIfAborted: (value: AbortSignal) => value.throwIfAborted(),
		applyMediaChannelMapping, createStreamingWindowedSincResampler, createWavStreamEncoder,
		ffmpeg: { encodeFile(blob: Blob) { return { blob, mimeType: 'audio/mpeg' }; } },
		createStableId: () => 'loop', normalizeProjectSampleRate: (value: number) => value,
		withRenderProgress: (value: object) => value,
		createCacheAwareRenderEngine() {
			return { project: null, loadProject() {}, dispose() { disposed++; },
				async renderMixRealtime(request: EngineRealtimeRenderOptions) {
					assert.equal(request.preRollFrames, false); assert.equal(request.includeTail, 6 / rate);
					for (let offset = 0; offset < 10; offset += 3) {
						await request.onChunk?.(captured.map(channel => channel.subarray(offset, offset + 3)), { sampleRate: rate });
					}
				},
			};
		},
		createTemporaryFileSink() {
			const parts: Uint8Array<ArrayBuffer>[] = [];
			return { persistent: true, write(bytes: Uint8Array) { parts.push(new Uint8Array(bytes)); },
				close() { return new Blob(parts); }, remove() { removed++; }, abort() { throw new Error('Unexpected abort'); },
			};
		},
	};
	const output = await createRealtimeEncodedAudioExport(runtime)(
		{ sampleRate: rate, masterChannels: 1 }, { ...plan, format, render: { strategy: 'realtime-stream' } },
		{ includeTail: false }, signal, sources, {},
	);
	assert.deepEqual(Array.from(readWavePcm(new Uint8Array(await output.blob.arrayBuffer())).channels[0]!), expected);
	assert.equal(disposed, 1);
	assert.equal(removed, format === 'wav' ? 1 : 2);
	await output.cleanup?.(); assert.equal(removed, 2);
});
