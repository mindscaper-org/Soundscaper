/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeNativeContainerAudio, assertNativeContainerAudioGeometry, nativeContainerAudioAdmission } from '../src/common/editor/controller/import/internal/native-container-audio-admission.ts';
import { MockAudioBuffer } from './helpers/mock-audio-context.js';
import { mpegTwoMp3_16_000Fixture } from './helpers/os-audio-codec-fixtures.ts';

test('complete low-rate MPEG packets retain their gapless native sample clock', async () => {
	const { file } = mpegTwoMp3_16_000Fixture();
	assert.deepEqual(await nativeContainerAudioAdmission(file, { nativeSampleRate: () => assert.fail('The source owns its clock') }), {
		sampleRate: 16_000, decodeSampleRate: 16_000, channelCount: 1, frameCount: 1600,
		trimNativeMpeg: { encodedFrames: 2880, leadingFrames: 1105 },
	});
});

test('damaged low-rate MPEG packet inventories retain the ordinary decoder decision', async () => {
	const { file } = mpegTwoMp3_16_000Fixture();
	for (const kind of ['sync', 'rate', 'channels', 'truncated', 'trailing'] as const) {
		let bytes = new Uint8Array(await file.arrayBuffer());
		if (kind === 'sync') bytes[225] = 0;
		if (kind === 'rate') bytes[227]! ^= 4;
		if (kind === 'channels') bytes[228]! &= 0x3f;
		if (kind === 'truncated') bytes = bytes.slice(0, -1);
		const changed = new Blob([bytes, ...(kind === 'trailing' ? [Uint8Array.of(0)] : [])]);
		assert.equal(await nativeContainerAudioAdmission(changed, { nativeSampleRate: () => 48_000 }), null, kind);
	}
});


test('native MPEG normalization trims only the exact encoded geometry and retains PCM by view', async () => {
	const { file } = mpegTwoMp3_16_000Fixture();
	const admission = await nativeContainerAudioAdmission(file, { nativeSampleRate: () => 48_000 });
	const buffer = new MockAudioBuffer(1, 2880, 16_000);
	buffer.getChannelData(0).set(Float32Array.from({ length: 2880 }, (_, i) => i));
	const normalized = normalizeNativeContainerAudio(buffer as unknown as AudioBuffer, admission);
	assert.equal(normalized.length, 1600);
	assert.equal(normalized.getChannelData(0)[0], 1105);
	assert.equal(normalized.getChannelData(0)[1599], 2704);
	assert.equal(normalized.getChannelData(0).buffer, buffer.getChannelData(0).buffer);
	assert.doesNotThrow(() => assertNativeContainerAudioGeometry(normalized, admission));
	assert.throws(() => assertNativeContainerAudioGeometry({ sampleRate: 16_000, numberOfChannels: 1, length: 2881 }, admission));
});
