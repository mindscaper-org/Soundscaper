/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { audioBuffer, createMemoryRenderEngine } from './helpers/audio-editor-controller-harness.js';
import { readRiffChunks } from './helpers/read-riff-chunks.ts';
import { createWavHeader, createWavStreamEncoder, encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { createWavBlobPcmChunkReader } from '../src/common/editor/wav-pcm-chunk-reader.ts';

/** Read the WAVEFORMATEXTENSIBLE speaker field independently of import admission. */
function waveFormat(bytes: Uint8Array): DataView {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const size = view.getUint32(offset + 4, true);
		if (new TextDecoder().decode(bytes.subarray(offset, offset + 4)) === 'fmt ') return new DataView(bytes.buffer, bytes.byteOffset + offset + 8, size);
		offset += 8 + size + (size & 1);
	}
	throw new Error('WAV is missing its format chunk.');
}

for (const port of ['buffered', 'streamed'] as const) test(`the ${port}20bit mono writer declares the centre speaker`, async () => {
	const input = Float32Array.of(0, .125, -.25, .5);
	let bytes: Uint8Array;
	if (port === 'buffered') bytes = encodeWav([input], { bitDepth: 20, dither: false });
	else {
		const writer = createWavStreamEncoder({ channelCount: 1, totalFrames: input.length, bitDepth: 20, dither: false });
		writer.write([input]); const result = writer.finalize(); assert.ok(result instanceof Uint8Array); bytes = result;
	}
	const format = waveFormat(bytes);
	assert.equal(format.getUint16(0, true), 0xfffe); assert.equal(format.getUint16(2, true), 1);
	assert.equal(format.getUint16(18, true), 20); assert.equal(format.getUint32(20, true), 4, 'mono is SPEAKER_FRONT_CENTER, not the left-only role');
	const blob = new Blob([new Uint8Array(bytes)]); const descriptor = await inspectWavBlobPcm(blob);
	const { channels } = await createWavBlobPcmChunkReader(blob, { descriptor }).readChunk(0);
	assert.deepEqual(channels, [input]); assert.equal(descriptor.frameCount, input.length);
});

test('large mono RF64 headers retain the same centre-speaker declaration', () => {
	const header = createWavHeader({ channelCount: 1, bitDepth: 20, totalFrames: 1_500_000_000 });
	assert.equal(new TextDecoder().decode(header.subarray(0, 4)), 'RF64');
	assert.equal(waveFormat(header).getUint32(20, true), 4);
});

test('explicit mono speaker roles and ordinary stereo output keep their own declarations', () => {
	for (const channelMask of [0, 1, 4, 8]) {
		const bytes = encodeWav([Float32Array.of(.25)], { bitDepth: 20, channelMask });
		assert.equal(waveFormat(bytes).getUint32(20, true), channelMask);
	}
	assert.equal(waveFormat(encodeWav([Float32Array.of(.25), Float32Array.of(-.25)], { bitDepth: 20 })).getUint32(20, true), 3);
	assert.equal(waveFormat(encodeWav([Float32Array.of(.25)], { bitDepth: 24 })).getUint16(0, true), 1);
});

for (const bits of [20, 24]) test(`the controller exports ${bits}bit mono through its actual PCM writer`, async context => {
	type Options = NonNullable<Parameters<typeof controllerSession>[1]>;
	const { controller } = await controllerSession(context, { engineFactory: (() => ({ ...createMemoryRenderEngine(),
		renderMix: async () => audioBuffer([new Float32Array(2400).fill(.125), new Float32Array(2400).fill(-.0625)], 48_000),
	})) as unknown as Options['engineFactory'] });
	await controller.actions.project.importFiles([new File([Uint8Array.from(encodeWav([new Float32Array(2400).fill(.125)], { sampleRate: 48_000 }))], 'Mono.wav')]);
	const output: unknown = await controller.actions.export.start({ format: 'wav', bitDepth: bits, channelMapping: 'mono', includeTail: false, dither: 'none' });
	assert.ok(output && typeof output === 'object' && 'method' in output && 'url' in output);
	assert.equal(output.method, 'object-url'); assert.ok(typeof output.url === 'string');
	const response = await fetch(output.url); assert.equal(response.ok, true);
	const bytes = new Uint8Array(await response.arrayBuffer()), format = waveFormat(bytes);
	assert.equal(format.getUint16(2, true), 1);
	if (bits === 20) assert.equal(format.getUint32(20, true), 4);
	const pcm = readRiffChunks(bytes).get('data'); assert.ok(pcm); assert.equal(pcm.length, 2400 * 3);
	const expected = (.125 - .0625) / 2, data = Buffer.from(pcm);
	for (let frame = 0; frame < 2400; frame++) assert.ok(Math.abs(data.readIntLE(frame * 3, 3) / 8388608 - expected) <= 2 ** (1 - bits));
});
