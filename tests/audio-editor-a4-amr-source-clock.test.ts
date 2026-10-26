/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectDecodedAudioSampleRate, inspectEncodedAudioSampleRate } from '../src/common/editor/audio-file-metadata.js';
import { nativeAmrwbFixture } from './helpers/native-amrwb-fixture.ts';
import { inspectAmrWbAudioSampleRate } from '../src/common/editor/amr-wb-audio-sample-rate.ts';

test('ordinary AMR-WB storage retains its encoded16k clock', async () => {
	assert.equal(inspectEncodedAudioSampleRate(await nativeAmrwbFixture().file.arrayBuffer()), 16_000);
});

test('native AMR-WB decode is pinned to its own16k clock instead of the output device', async () => {
	assert.equal(inspectDecodedAudioSampleRate(await nativeAmrwbFixture().file.arrayBuffer()), 16_000);
});

test('AMR-WB clock probe honors byte views and complete variable-rate speech/SID/no-data frames', async () => {
	const original = new Uint8Array(await nativeAmrwbFixture().file.arrayBuffer()), backing = new Uint8Array(original.length + 17);
	backing.set(original, 9); assert.equal(inspectAmrWbAudioSampleRate(backing.subarray(9, 9 + original.length)), 16_000);
	const header = new TextEncoder().encode('#!AMR-WB\n');
	for (const [mode, length] of [[0, 18], [1, 24], [2, 33], [3, 37], [4, 41], [5, 47], [6, 51], [7, 59], [8, 61], [9, 6], [14, 1], [15, 1]] as const) {
		const bytes = new Uint8Array(header.length + length); bytes.set(header); bytes[header.length] = (mode << 3) | 4;
		assert.equal(inspectAmrWbAudioSampleRate(bytes), 16_000);
		if (length > 1) assert.equal(inspectAmrWbAudioSampleRate(bytes.subarray(0, bytes.length - 1)), null);
	}
});

test('unknown/multichannel AMR storage, incomplete frames and reserved types cannot claim a clock', async () => {
	const original = new Uint8Array(await nativeAmrwbFixture().file.arrayBuffer());
	for (const header of [0x80 | 0x44, 0x44 | 1, 0x44 | 2, 10 << 3, 11 << 3, 12 << 3, 13 << 3]) {
		const bytes = Uint8Array.from(original); bytes[9] = header; assert.equal(inspectDecodedAudioSampleRate(bytes), null);
	}
	for (const bytes of [original.subarray(0, 9), original.subarray(0, original.length - 1),
		new TextEncoder().encode('#!AMR\n'), new TextEncoder().encode('#!AMR-WB_MC1.0\n')]) {
		assert.equal(inspectEncodedAudioSampleRate(bytes), null); assert.equal(inspectDecodedAudioSampleRate(bytes), null);
	}
	const excess = new Uint8Array(9 + 1_000_001); excess.set(original.subarray(0, 9)); excess.fill(15 << 3, 9);
	assert.equal(inspectAmrWbAudioSampleRate(excess), null);
});
