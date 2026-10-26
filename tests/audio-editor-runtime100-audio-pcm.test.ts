/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { PcmRepository } from '../src/common/editor/storage/pcm-repository.ts';
import { crc32, PCM_ENCODING_WAVPACK_F32_V1 } from '../src/common/editor/wavpack/index.js';

const options = { frames: 1024, channelCount: 1, sampleRate: 48000, priority: 'migration', allowRawOnFailure: true, requireWavPack: true };
function repository(payload: ArrayBuffer, corruptByte = -1): PcmRepository {
	return new PcmRepository({ codec: {
		async encode(raw: ArrayBuffer) { return { encoding: PCM_ENCODING_WAVPACK_F32_V1, payload: new ArrayBuffer(8), pcmCrc32: crc32(raw) }; },
		async decode() { const output = payload.slice(0); if (corruptByte >= 0) new Uint8Array(output)[corruptByte]! ^= 1; return { payload: output }; },
	} });
}

test('A16 required WavPack compares exact sample words rather than individual bytes', async () => {
	const words = Uint32Array.from({ length: 1024 }, (_, index) => [0, 0x80000000, 0x7fc00001, 0x7fc00002, 0x3f800000][index % 5]!);
	const bytesSome = Uint8Array.prototype.some;
	const wordsSome = Uint32Array.prototype.some;
	let comparisons = 0;
	Uint8Array.prototype.some = function (predicate, receiver) { return bytesSome.call(this, (value, index, array) => { comparisons++; return predicate.call(receiver, value, index, array); }); };
	Uint32Array.prototype.some = function (predicate, receiver) { return wordsSome.call(this, (value, index, array) => { comparisons++; return predicate.call(receiver, value, index, array); }); };
	try {
		const result = await repository(words.buffer).encode(words.buffer, options);
		assert.equal(result.encoding, PCM_ENCODING_WAVPACK_F32_V1);
		assert.equal(comparisons, words.length);
	} finally { Uint8Array.prototype.some = bytesSome; Uint32Array.prototype.some = wordsSome; }
	for (const byte of [0, 1, 2, 3, 7, 8, 12, 4095]) {
		const pcm = repository(words.buffer, byte);
		await assert.rejects(pcm.encode(words.buffer, options), /exact source sample bits/);
		await assert.rejects(pcm.encode(words.buffer, options), /disabled/);
	}
	await assert.rejects(repository(new ArrayBuffer(3)).encode(words.buffer, options), /exact source sample bits/);
});
