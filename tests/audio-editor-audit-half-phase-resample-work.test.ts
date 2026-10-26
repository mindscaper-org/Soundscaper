/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createStreamingWindowedSincResampler } from '../src/common/editor/resample.js';

function convert(input: readonly Float32Array[], inputRate: number, outputRate: number, chunk: number) {
	const converter = createStreamingWindowedSincResampler(inputRate, outputRate, input.length);
	const parts: Float32Array[][] = [];
	for (let offset = 0; offset < input[0]!.length; offset += chunk) parts.push(converter.push(input.map(channel => channel.subarray(offset, offset + chunk))));
	parts.push(converter.finish());
	return input.map((_, channel) => {
		const values = new Float32Array(parts.reduce((total, part) => total + part[channel]!.length, 0));
		let offset = 0;
		for (const part of parts) { values.set(part[channel]!, offset); offset += part[channel]!.length; }
		return values;
	});
}
function digest(channels: readonly Float32Array[]) {
	const hash = createHash('sha256');
	for (const channel of channels) hash.update(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength));
	return hash.digest('hex');
}

test('twofold conversion reuses exact half-phase kernels across streamed channel chunks', () => {
	const input = Array.from({ length: 2 }, (_, channel) => Float32Array.from({ length: 4_096 }, (_, index) =>
		index % 127 === 0 ? -0 : Math.sin(index * 0.031 + channel) * 0.5));
	const cosine = Math.cos;
	let calls = 0;
	Math.cos = value => { calls++; return cosine(value); };
	let converted: Float32Array[];
	try { converted = convert(input, 48_000, 96_000, 127); } finally { Math.cos = cosine; }
	assert.equal(converted[0]!.length, 8_192);
	assert.equal(digest(converted), 'de5330d7c1fbf147e2ae9dcb25339d90fd2b2edd80d1582e84a26626835ebeff');
	assert.deepEqual(convert(input, 48_000, 96_000, input[0]!.length), converted);
	assert.ok(calls <= 5_000, `${calls} repeated cosine evaluations`);
});
