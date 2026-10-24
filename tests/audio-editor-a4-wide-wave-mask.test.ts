/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav, createWavHeader } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';

for (const channelCount of [19, 24, 31, 32]) test(`ordinary ${channelCount}-channel WAV declares direct output rather than reserved speaker positions`, async () => {
	const channels = Array.from({ length: channelCount }, (_, channel) => Float32Array.from({ length: 16 }, () => (channel + 1) / 64));
	const bytes = Uint8Array.from(encodeWav(channels, { sampleRate: 48000, bitDepth: 20, dither: false }));
	const geometry = await inspectWavBlobPcm(new Blob([bytes.buffer]));
	assert.equal(geometry.channelCount, channelCount); assert.equal(geometry.channelMask, 0);
	const header = createWavHeader({ sampleRate: 48000, channelCount, totalFrames: 16, bitDepth: 20, dither: false });
	assert.equal(new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(40, true), 0);
});

test('defined speaker counts and explicit direct/custom masks retain their established headers', async () => {
	for (const channelCount of [1, 2, 6, 8, 18]) {
		const bytes = Uint8Array.from(encodeWav(Array.from({ length: channelCount }, () => new Float32Array(16)), { sampleRate: 48000, bitDepth: 20, dither: false }));
		const geometry = await inspectWavBlobPcm(new Blob([bytes.buffer]));
		assert.equal(geometry.channelMask, channelCount === 1 ? 4 : 2 ** channelCount - 1);
	}
	for (const [channelCount, channelMask] of [[2, 5], [19, 0], [32, 0x3ffff]] as const) {
		const bytes = Uint8Array.from(encodeWav(Array.from({ length: channelCount }, () => new Float32Array(16)), { sampleRate: 48000, bitDepth: 20, dither: false, channelMask }));
		const geometry = await inspectWavBlobPcm(new Blob([bytes.buffer])); assert.equal(geometry.channelMask, channelMask);
	}
});
