/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectEncodedAudioSampleRate, inspectDecodedAudioSampleRate } from '../src/common/editor/audio-file-metadata.js';
import { decodeStandaloneAudioForImport } from '../src/common/editor/controller/import/internal/standalone-audio-import-decoder.ts';
import { nativeApeFixture } from './helpers/native-ape-fixture.ts';

for (const inspect of [inspectEncodedAudioSampleRate, inspectDecodedAudioSampleRate]) test(`ordinary Monkey’s Audio source pins its32k ${inspect.name} clock`, async () => {
	const bytes = new Uint8Array(await nativeApeFixture().file.arrayBuffer());
	assert.equal(inspect(bytes), 32_000);
	const backing = new Uint8Array(bytes.length + 29); backing.set(bytes, 17);
	assert.equal(inspect(backing.subarray(17, 17 + bytes.length)), 32_000);
});

test('standalone native Monkey’s Audio import asks for the authenticated source clock rather than a44.1k device', async () => {
	const { file } = nativeApeFixture(), requested: (number | null)[] = [];
	const result = await decodeStandaloneAudioForImport({ file, codecRuntime: {}, sampleRate: 48_000,
		async getAudioContext() { return { sampleRate: 44_100 }; },
		async decodeWithWebAudio(_encoded, rate) { requested.push(rate); return { sampleRate: rate ?? 44_100 }; },
		async decodeWithCodec() { throw new Error('The native-supported source must not use fallback.'); },
		async bufferFromChannels() { throw new Error('Native PCM is already decoded.'); },
		inspectEncodedSampleRate: inspectEncodedAudioSampleRate, inspectDecodedSampleRate: inspectDecodedAudioSampleRate,
	});
	assert.deepEqual(requested, [32_000]); assert.equal(result.decoded.sampleRate, 32_000); assert.equal(result.originalSampleRate, 32_000);
});


test('APE clock authority declines inconsistent or incomplete descriptor, header and seek extents', async () => {
	const original = new Uint8Array(await nativeApeFixture().file.arrayBuffer());
	for (const [offset, value, width] of [[0, 0, 1], [4, 3980, 2], [6, 1, 2], [8, 51, 4], [12, 23, 4], [16, 8, 4], [20, 0, 4],
		[20, 1024 * 1024 + 1, 4], [24, 0, 4], [24, original.length, 4], [28, 1, 4], [32, original.length, 4], [52, 6000, 2], [54, 1, 2],
		[54, 32, 2], [56, 73729, 4], [60, 0, 4], [60, 73729, 4], [64, 0, 4], [64, 1_000_001, 4], [68, 24, 2], [70, 0, 2], [70, 3, 2],
		[72, 0, 4], [72, 1000, 4], [72, 768000, 4], [76, 123, 4], [76, 125, 4]] as const) {
		const bytes = Uint8Array.from(original), view = new DataView(bytes.buffer);
		if (width === 4) view.setUint32(offset, value, true); else if (width === 2) view.setUint16(offset, value, true); else view.setUint8(offset, value);
		assert.equal(inspectEncodedAudioSampleRate(bytes), null, `field${offset}=${value}`);
		assert.equal(inspectDecodedAudioSampleRate(bytes), null, `field${offset}=${value}`);
	}
	for (const length of [0, 4, 75, 79, 123, original.length - 1]) assert.equal(inspectDecodedAudioSampleRate(original.subarray(0, length)), null);
});

test('APE seek walk validates every packet while leaving native-owned optional tags intact', async () => {
	const original = new Uint8Array(await nativeApeFixture().file.arrayBuffer());
	const tagged = new Uint8Array(original.length + 256); tagged.set(original);
	assert.equal(inspectDecodedAudioSampleRate(tagged), 32_000);
	// Preserve all ordinary producer packet bytes while constructing a header-only authority control.
	const bytes = new Uint8Array(original.length + 4); bytes.set(original.subarray(0, 76)); bytes.set(original.subarray(80), 84);
	const view = new DataView(bytes.buffer); view.setUint32(16, 8, true); view.setUint32(64, 2, true);
	view.setUint32(76, 128, true); view.setUint32(80, 132, true);
	assert.equal(inspectDecodedAudioSampleRate(bytes), 32_000);
	for (const offset of [0, 127, 129, bytes.length - 3, bytes.length]) {
		view.setUint32(80, offset, true); assert.equal(inspectDecodedAudioSampleRate(bytes), null);
	}
	// Declared PCM admission precedes the packet-table walk.
	view.setUint32(64, 1000, true); view.setUint32(16, 4000, true);
	assert.equal(inspectDecodedAudioSampleRate(bytes), null);
});
