/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { applyAudacityTruncateSilence } from '../src/common/editor/audacity-effects/basic.js';

const hashes = {
	128: { truncate: 'c11604a16f5ac3ed803a8ae00bcdec4d89dc1b810f325ae2bce177ec26ff6d53', compress: '84a2c3e1016c43ded260a1583bc4fc1eb9c49f60a7a7ac157dd6624bf6031a10' },
	24: { truncate: '369ee8557c3edc8c475db940427b5670feb89330061d9d64677b8f23e394ac9c', compress: 'e7836a7f44fae662fb64ecdae84f7990e87d663fa8d2a3228a8e094550487650' },
} as const;

test('disjoint silence cuts copy retained PCM once and preserve complete legacy crossfade output', context => {
	const originalSet = Float32Array.prototype.set;
	let copied = 0;
	context.mock.method(Float32Array.prototype, 'set', function (this: Float32Array, input: ArrayLike<number>, offset?: number) {
		copied += input.length; return originalSet.call(this, input, offset);
	});
	for (const block of [128, 24] as const) for (const independent of [false, true]) for (const action of ['truncate', 'compress'] as const) {
		const channels = Array.from({ length: 2 }, (_, channel) => Float32Array.from({ length: 20 * block * 2 }, (_, frame) =>
			frame % (block * 2) < block ? (channel ? -0.35 : 0.25) * (frame % 7 + 1) / 7 : (frame % 17 === 0 ? -0 : 0)));
		copied = 0;
		const output = applyAudacityTruncateSilence(channels, 8_000, { minimumSilence: 0.001, thresholdDb: -60, truncateTo: 0, compressPercent: 35, independent, action });
		assert.equal(createHash('sha256').update(Buffer.concat(output.map((channel: Float32Array) => Buffer.from(channel.buffer)))).digest('hex'), hashes[block][action]);
		if (block === 128) assert.ok(copied <= channels[0]!.length * 2, `retained spans should copy once, received ${copied} frames`);
	}
});
