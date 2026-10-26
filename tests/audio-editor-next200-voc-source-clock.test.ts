/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectDecodedAudioSampleRate, inspectEncodedAudioSampleRate } from '../src/common/editor/audio-file-metadata.js';
import { inspectVocPcmSampleRate } from '../src/common/editor/voc-pcm-sample-rate.ts';
import { nativeVocFixture } from './helpers/native-voc-fixture.ts';

for (const sampleRate of [48_000, 96_000] as const) test(`an ordinary complete VOC PCM16 recording pins its ${sampleRate}Hz source and native decode clock`, async () => {
	const bytes = await nativeVocFixture(sampleRate).file.arrayBuffer();
	assert.equal(inspectEncodedAudioSampleRate(bytes), sampleRate);
	assert.equal(inspectDecodedAudioSampleRate(bytes), sampleRate);
});


test('VOC source clock authority requires a complete unambiguous PCM16 block', async () => {
	const original = new Uint8Array(await nativeVocFixture().file.arrayBuffer());
	const backing = new Uint8Array(original.length + 18); backing.set(original, 9);
	assert.equal(inspectVocPcmSampleRate(backing.subarray(9, original.length + 9)), 48_000);
	const changes: ReadonlyArray<(bytes: Uint8Array<ArrayBuffer>, view: DataView) => void> = [
		bytes => { bytes[0] = 0; }, bytes => { bytes[19] = 0; },
		(_bytes, view) => { view.setUint16(20, 27, true); },
		(_bytes, view) => { view.setUint16(22, 0x0113, true); },
		(_bytes, view) => { view.setUint16(24, 0, true); },
		bytes => { bytes[26] = 1; }, bytes => { bytes[27] = 0; },
		(_bytes, view) => { view.setUint32(30, 0, true); },
		(_bytes, view) => { view.setUint32(30, 400_000, true); },
		bytes => { bytes[34] = 8; }, bytes => { bytes[35] = 6; },
		(_bytes, view) => { view.setUint16(36, 1, true); },
		bytes => { bytes[bytes.length - 1] = 9; },
	];
	for (const change of changes) {
		const bytes = Uint8Array.from(original); change(bytes, new DataView(bytes.buffer));
		assert.equal(inspectVocPcmSampleRate(bytes), null);
		assert.equal(inspectDecodedAudioSampleRate(bytes), null);
	}
	for (const length of [0, 26, 42, 44, original.length - 1]) assert.equal(inspectVocPcmSampleRate(original.subarray(0, length)), null);
	const trailing = new Uint8Array(original.length + 1); trailing.set(original);
	assert.equal(inspectVocPcmSampleRate(trailing), null);
});
