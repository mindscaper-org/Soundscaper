/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectDecodedAudioSampleRate, inspectEncodedAudioSampleRate } from '../src/common/editor/audio-file-metadata.js';
import { readQuickTimePcmSampleDescription } from '../src/common/editor/quicktime-pcm-sample-description.ts';
import { nativeQuickTimePcmFixture } from './helpers/quicktime-pcm-audio-fixture.ts';

for (const format of ['twos', 'sowt'] as const) test(`native QuickTime ${format} keeps its lossless source clock`, async () => {
	const bytes = new Uint8Array(await nativeQuickTimePcmFixture(format).arrayBuffer());
	assert.equal(inspectEncodedAudioSampleRate(bytes), 48_000);
	assert.equal(inspectDecodedAudioSampleRate(bytes), 48_000);
});

test('PCM clock admission retains the exact uncompressed description and bounded extension authority', async () => {
	const encoded = Buffer.from(await nativeQuickTimePcmFixture('twos').arrayBuffer());
	const start = encoded.indexOf('stsd') - 4, end = start + encoded.readUInt32BE(start);
	const description = encoded.subarray(start, end);
	assert.deepEqual(readQuickTimePcmSampleDescription(description), { sampleRate: 48_000, channelCount: 2 });
	for (const [offset, value] of [[12, 2], [32, 1], [36, 1], [40, 3], [42, 24], [44, 1], [46, 1], [50, 1], [52, 1]] as const) {
		const changed = Uint8Array.from(description); new DataView(changed.buffer).setUint16(offset, value);
		assert.equal(readQuickTimePcmSampleDescription(changed), null);
	}
	const aac = Uint8Array.from(description); aac.set(Buffer.from('mp4a'), 20);
	assert.equal(readQuickTimePcmSampleDescription(aac), null);
	const completeAac = Uint8Array.from(encoded); completeAac.set(aac, start);
	assert.equal(inspectDecodedAudioSampleRate(completeAac), null, 'AAC/SBR rate remains deliberately unpinned');
	for (const bytes of [description.subarray(0, 51), description.subarray(0, -1), new Uint8Array([...description, 0])]) {
		assert.equal(readQuickTimePcmSampleDescription(bytes), null);
	}
});
