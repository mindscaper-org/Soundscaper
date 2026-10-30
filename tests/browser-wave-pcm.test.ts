/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { readWavePcm } from './helpers/read-wave-pcm.ts';

function wave(format: number, bits: number, samples: readonly number[], channels = 1): Buffer {
	const pcm = Buffer.alloc(samples.length * bits / 8);
	for (const [index, sample] of samples.entries()) {
		if (format === 3) pcm.writeFloatLE(sample, index * 4);
		else pcm.writeIntLE(sample, index * bits / 8, bits / 8);
	}
	const header = Buffer.alloc(44);
	header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
	header.writeUInt32LE(16, 16); header.writeUInt16LE(format, 20); header.writeUInt16LE(channels, 22);
	header.writeUInt32LE(48_000, 24); header.writeUInt32LE(48_000 * channels * bits / 8, 28);
	header.writeUInt16LE(channels * bits / 8, 32); header.writeUInt16LE(bits, 34);
	header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}

test('the browser export oracle reads interleaved float PCM without resampling or a browser decoder', () => {
	const file = wave(3, 32, [.25, -.5, .75, 0], 2);
	// A download may be a view into a larger Buffer.
	const backing = Buffer.concat([Buffer.of(1, 2, 3), file]);
	const decoded = readWavePcm(backing.subarray(3));
	assert.equal(decoded.sampleRate, 48_000);
	assert.deepEqual(decoded.channels.map(channel => Array.from(channel)), [[.25, .75], [-.5, 0]]);
});

for (const bits of [16, 24, 32]) test(`the browser export oracle normalizes ${bits}-bit signed PCM`, () => {
	const scale = 2 ** (bits - 1);
	assert.deepEqual(Array.from(readWavePcm(wave(1, bits, [-scale, -scale / 2, 0, scale / 2])).channels[0]), [-1, -.5, 0, .5]);
});

test('the browser export oracle walks padded metadata rather than assuming a 44-byte header', () => {
	const file = wave(3, 32, [.125, -.125]);
	const metadata = Buffer.from([74, 85, 78, 75, 1, 0, 0, 0, 42, 0]);
	const expanded = Buffer.concat([file.subarray(0, 36), metadata, file.subarray(36)]);
	expanded.writeUInt32LE(expanded.length - 8, 4);
	assert.deepEqual(Array.from(readWavePcm(expanded).channels[0]), [.125, -.125]);
});

test('the browser export oracle rejects truncated, compressed, or malformed PCM instead of comparing partial samples', () => {
	const file = wave(3, 32, [.25, -.5]);
	assert.throws(() => readWavePcm(file.subarray(0, -1)), /truncated/u);
	const compressed = Buffer.from(file); compressed.writeUInt16LE(6, 20);
	assert.throws(() => readWavePcm(compressed), /PCM/u);
	const misaligned = Buffer.from(file); misaligned.writeUInt16LE(7, 32);
	assert.throws(() => readWavePcm(misaligned), /alignment/u);
	const incomplete = Buffer.from(file); incomplete.writeUInt32LE(7, 40);
	assert.throws(() => readWavePcm(incomplete), /frame/u);
});
