/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectDecodedAudioSampleRate, inspectEncodedAudioSampleRate } from '../src/common/editor/audio-file-metadata.js';
import { inspectDtsAudioSampleRate } from '../src/common/editor/dts-audio-sample-rate.ts';
import { nativeDtsFixture } from './helpers/dts-native-audio-fixture.ts';

test('native DTS-core import derives its source clock from complete syncframes', async () => {
	const bytes = new Uint8Array(await nativeDtsFixture().arrayBuffer());
	assert.equal(inspectEncodedAudioSampleRate(bytes), 48_000);
	assert.equal(inspectDecodedAudioSampleRate(bytes), 48_000);
});

test('DTS source-clock hints require complete consistent core framing and respect byte views', async () => {
	const bytes = new Uint8Array(await nativeDtsFixture().arrayBuffer());
	const padded = new Uint8Array(bytes.length + 13); padded.set(bytes, 7);
	assert.equal(inspectDtsAudioSampleRate(padded.subarray(7, 7 + bytes.length)), 48_000);
	for (const input of [bytes.subarray(0, 17), bytes.subarray(0, bytes.length - 1), new Uint8Array([...bytes, 0]),
		new Uint8Array(bytes.length)]) assert.equal(inspectDtsAudioSampleRate(input), null);
	for (const [offset, mask] of [[0, 128], [4, 128], [9, 16], [10, 16], [10, 32], [1884 + 8, 4]] as const) {
		const changed = bytes.slice(); changed[offset]! ^= mask;
		assert.equal(inspectDtsAudioSampleRate(changed), null);
	}
});
