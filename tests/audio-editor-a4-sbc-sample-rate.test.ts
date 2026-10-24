/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectEncodedAudioSampleRate, inspectDecodedAudioSampleRate } from '../src/common/editor/audio-file-metadata.js';
import { decodeStandaloneAudioForImport } from '../src/common/editor/controller/import/internal/standalone-audio-import-decoder.ts';
import { nativeSbcFixture } from './helpers/native-sbc-fixture.ts';

for (const inspect of [inspectEncodedAudioSampleRate, inspectDecodedAudioSampleRate]) test(`ordinary SBC source pins its32k ${inspect.name} clock`, async () => {
	const bytes = new Uint8Array(await nativeSbcFixture().file.arrayBuffer());
	assert.equal(inspect(bytes), 32_000);
	const backing = new Uint8Array(bytes.length + 29); backing.set(bytes, 17);
	assert.equal(inspect(backing.subarray(17, 17 + bytes.length)), 32_000);
});

test('standalone native SBC import asks for the authenticated source clock rather than a44.1k device', async () => {
	const { file } = nativeSbcFixture(), requested: (number | null)[] = [];
	const result = await decodeStandaloneAudioForImport({ file, codecRuntime: {}, sampleRate: 48_000,
		async getAudioContext() { return { sampleRate: 44_100 }; },
		async decodeWithWebAudio(_encoded, rate) { requested.push(rate); return { sampleRate: rate ?? 44_100 }; },
		async decodeWithCodec() { throw new Error('The native-supported source must not use fallback.'); },
		async bufferFromChannels() { throw new Error('Native PCM is already decoded.'); },
		inspectEncodedSampleRate: inspectEncodedAudioSampleRate, inspectDecodedSampleRate: inspectDecodedAudioSampleRate,
	});
	assert.deepEqual(requested, [32_000]); assert.equal(result.decoded.sampleRate, 32_000); assert.equal(result.originalSampleRate, 32_000);
});


test('rawSBC clock authority rejects partial, CRC-corrupt, foreign, mixed-clock and trailing input', async () => {
	const original = new Uint8Array(await nativeSbcFixture().file.arrayBuffer());
	for (const offset of [0, 1, 2, 3, 4, 10, original.length - 65 + 3]) {
		const bytes = Uint8Array.from(original); bytes[offset] = bytes[offset]! ^ 1;
		assert.equal(inspectEncodedAudioSampleRate(bytes), null); assert.equal(inspectDecodedAudioSampleRate(bytes), null);
	}
	for (const length of [0, 3, 6, original.length - 1]) assert.equal(inspectDecodedAudioSampleRate(original.subarray(0, length)), null);
	// A complete frame from a second untouched FFmpeg48k SBC producer has a
	// valid CRC but cannot establish one clock with this32k stream.
	const otherRate = Uint8Array.from(Buffer.from('nP0Pef7FQiIRsyAAAn9+/v4B/BPot7QubJvfN8ZzkPsWLezbKtR3pPNBaw==', 'base64'));
	for (const trailer of [Uint8Array.of(0), otherRate]) {
		const bytes = new Uint8Array(original.length + trailer.length); bytes.set(original); bytes.set(trailer, original.length);
		assert.equal(inspectDecodedAudioSampleRate(bytes), null);
	}
});
