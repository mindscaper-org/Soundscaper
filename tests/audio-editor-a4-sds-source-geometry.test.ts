/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPcmSamplesEqual } from './helpers/assert-pcm-samples.ts';
import { inspectEncodedAudioSampleRate, inspectDecodedAudioSampleRate } from '../src/common/editor/audio-file-metadata.js';
import { normalizeNativeContainerAudio, isNativeContainerAudioView } from '../src/common/editor/controller/import/internal/native-container-audio-admission.ts';
import { decodeStandaloneAudioForImport } from '../src/common/editor/controller/import/internal/standalone-audio-import-decoder.ts';
import { nativeSdsFixture } from './helpers/native-sds-fixture.ts';
import { MockAudioBuffer } from './helpers/audio-editor-multitrack-selection-harness.js';
import { inspectSdsPcmSourceGeometry } from '../src/common/editor/sds-pcm-source-geometry.ts';

for (const inspect of [inspectEncodedAudioSampleRate, inspectDecodedAudioSampleRate]) test(`SDS keeps its authenticated32k ${inspect.name} clock`, async () => {
	const bytes = new Uint8Array(await nativeSdsFixture().file.arrayBuffer());
	assert.equal(inspect(bytes), 32_000);
	const backing = new Uint8Array(bytes.length + 19); backing.set(bytes, 9);
	assert.equal(inspect(backing.subarray(9, 9 + bytes.length)), 32_000);
});

test('native SDS import requests the authored clock rather than the current programme', async () => {
	const { file } = nativeSdsFixture(); let clock: number | null = null;
	const result = await decodeStandaloneAudioForImport({ file, codecRuntime: {}, sampleRate: 48_000,
		async getAudioContext() { return { sampleRate: 48_000 }; },
		async decodeWithWebAudio(_bytes, rate) { clock = rate; return { sampleRate: rate ?? 48_000 }; },
		async decodeWithCodec() { throw new Error('Existing native decoding remains the owner'); },
		async bufferFromChannels() { throw new Error('Native PCM is already decoded'); },
		inspectEncodedSampleRate: inspectEncodedAudioSampleRate, inspectDecodedSampleRate: inspectDecodedAudioSampleRate,
	});
	assert.equal(clock, 32_000); assert.equal(result.decoded.sampleRate, 32_000); assert.equal(result.originalSampleRate, 32_000);
});

test('authenticated SDS extent removes only native zero padding and stays out of the resident native cache', async () => {
	const { file, channels } = nativeSdsFixture(), encoded = await file.arrayBuffer();
	const buffer = new MockAudioBuffer(1, 5120, 32_000); buffer.getChannelData(0).set(channels[0]!);
	const view = normalizeNativeContainerAudio(buffer as unknown as AudioBuffer, null, encoded);
	assert.equal(view.length, 4800); assert.equal(view.duration, .15); assert.equal(view.sampleRate, 32_000);
	assertPcmSamplesEqual(view.getChannelData(0), channels[0]!); assert.equal(isNativeContainerAudioView(view), true);
	assert.equal(isNativeContainerAudioView(buffer), false);
});

for (const field of ['magic', 'command', 'bitwidth', 'period', 'count', 'loop', 'header-end', 'device', 'packet-type', 'sequence', 'high-bit', 'checksum', 'packet-end', 'truncated', 'trailing'] as const) {
	test(`unqualified SDS ${field} input cannot claim a decoded clock or endpoint`, async () => {
		let bytes = new Uint8Array(await nativeSdsFixture().file.arrayBuffer());
		if (field === 'magic') bytes[1] = 0;
		if (field === 'command') bytes[3] = 2;
		if (field === 'bitwidth') bytes[6] = 24;
		if (field === 'period') bytes.fill(0, 7, 10);
		if (field === 'count') bytes[10] = bytes[10]! + 40;
		if (field === 'loop') bytes[13] = 1;
		if (field === 'header-end') bytes[20] = 0;
		if (field === 'device') bytes[23] = 1;
		if (field === 'packet-type') bytes[24] = 1;
		if (field === 'sequence') bytes[21 + 127 + 4] = 2;
		if (field === 'high-bit') bytes[26] = 128;
		if (field === 'checksum') bytes[146] = bytes[146]! ^ 1;
		if (field === 'packet-end') bytes[147] = 0;
		if (field === 'truncated') bytes = bytes.subarray(0, bytes.length - 1);
		const file = field === 'trailing' ? new Uint8Array([...bytes, 0]) : bytes;
		assert.equal(inspectSdsPcmSourceGeometry(file), null);
		assert.equal(inspectEncodedAudioSampleRate(file), null); assert.equal(inspectDecodedAudioSampleRate(file), null);
		const decoded = new MockAudioBuffer(1, 5120, 32_000);
		assert.ok(Object.is(normalizeNativeContainerAudio(decoded as unknown as AudioBuffer, null, Uint8Array.from(file).buffer), decoded));
	});
}

test('SDS endpoint normalization refuses missing, nonzero, excessive or differently-clocked native PCM', async () => {
	const encoded = await nativeSdsFixture().file.arrayBuffer();
	for (const [channels, frames, rate, nonzero] of [[1, 4799, 32_000, false], [1, 5824, 32_000, false],
		[2, 5120, 32_000, false], [1, 5120, 48_000, false], [1, 5120, 32_000, true]] as const) {
		const decoded = new MockAudioBuffer(channels, frames, rate);
		if (nonzero) decoded.getChannelData(0)[4800] = .001;
		assert.throws(() => normalizeNativeContainerAudio(decoded as unknown as AudioBuffer, null, encoded), /native PCM/u);
	}
	const exact = new MockAudioBuffer(1, 4800, 32_000);
	assert.ok(Object.is(normalizeNativeContainerAudio(exact as unknown as AudioBuffer, null, encoded), exact));
});

test('SDS packet numbers wrap in seven bits while every packet keeps its checksum', async () => {
	const original = new Uint8Array(await nativeSdsFixture().file.arrayBuffer()), bytes = new Uint8Array(21 + 130 * 127);
	bytes.set(original.subarray(0, 21)); bytes[10] = 5200 % 128; bytes[11] = Math.floor(5200 / 128); bytes[12] = 0;
	for (let packet = 0; packet < 130; packet++) {
		const start = 21 + packet * 127; bytes.set(original.subarray(21, 148), start); bytes[start + 4] = packet % 128;
		let checksum = 0; for (let index = 1; index < 125; index++) checksum ^= bytes[start + index]!;
		bytes[start + 125] = checksum;
	}
	assert.deepEqual(inspectSdsPcmSourceGeometry(bytes), { sampleRate: 32_000, frameCount: 5200, channelCount: 1 });
});
