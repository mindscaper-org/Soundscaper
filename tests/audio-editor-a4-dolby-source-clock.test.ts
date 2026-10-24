/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectDecodedAudioSampleRate, inspectEncodedAudioSampleRate } from '../src/common/editor/audio-file-metadata.js';
import { inspectDolbyAudioSampleRate } from '../src/common/editor/dolby-audio-sample-rate.ts';
import { nativeDolbyFixture } from './helpers/dolby-native-audio-fixture.ts';

for (const format of ['ac3', 'eac3'] as const) test(`${format} native import derives its decoded source clock from complete syncframes`, async () => {
	const bytes = new Uint8Array(await nativeDolbyFixture(format).arrayBuffer());
	assert.equal(inspectEncodedAudioSampleRate(bytes), 48_000);
	assert.equal(inspectDecodedAudioSampleRate(bytes), 48_000);
});


test('Dolby clock sniffing requires complete consistent syncframes and respects byte views', async () => {
	for (const format of ['ac3', 'eac3'] as const) {
		const original = new Uint8Array(await nativeDolbyFixture(format).arrayBuffer());
		const padded = new Uint8Array(original.length + 13); padded.set(original, 7);
		assert.equal(inspectDolbyAudioSampleRate(padded.subarray(7, 7 + original.length)), 48_000);
		for (const bytes of [original.subarray(0, 6), original.subarray(0, original.length - 1), new Uint8Array([...original, 0]),
			new Uint8Array(original.length)]) assert.equal(inspectDolbyAudioSampleRate(bytes), null);
		const wrongVersion = original.slice(); wrongVersion[5] = 255;
		assert.equal(inspectDolbyAudioSampleRate(wrongVersion), null);
		const changingClock = original.slice(); changingClock[768 + 4]! ^= 64;
		assert.equal(inspectDolbyAudioSampleRate(changingClock), null);
	}
	const dependent = new Uint8Array(await nativeDolbyFixture('eac3').arrayBuffer()); dependent[2]! |= 64;
	assert.equal(inspectDolbyAudioSampleRate(dependent), null);
});
