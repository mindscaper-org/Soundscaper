/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPcmSamplesEqual } from './helpers/assert-pcm-samples.ts';
import { inspectDecodedAudioSampleRate, inspectEncodedAudioSampleRate } from '../src/common/editor/audio-file-metadata.js';
import { isNativeContainerAudioView, normalizeNativeContainerAudio } from '../src/common/editor/controller/import/internal/native-container-audio-admission.ts';
import { nativePafFixture } from './helpers/native-paf-fixture.ts';
import { inspectPafPcmSourceGeometry } from '../src/common/editor/paf-pcm-source-geometry.ts';

function nativeBuffer(channels: readonly Float32Array[], frames = 5120, rate = 48_000): AudioBuffer {
	const planes = channels.map(input => { const output = new Float32Array(frames); output.set(input.subarray(0, frames)); return output; });
	return { length: frames, duration: frames / rate, numberOfChannels: planes.length, sampleRate: rate,
		getChannelData: channel => planes[channel]!,
		copyFromChannel(destination, channel, offset = 0) { destination.set(planes[channel]!.subarray(offset, offset + destination.length)); },
		copyToChannel(source, channel, offset = 0) { planes[channel]!.set(source, offset); },
	};
}

test('ordinary complete PARIS PCM16 source pins its original and native decoded clock', async () => {
	const encoded = await nativePafFixture().file.arrayBuffer();
	assert.equal(inspectEncodedAudioSampleRate(encoded), 48_000); assert.equal(inspectDecodedAudioSampleRate(encoded), 48_000);
});

test('PARIS canonical storage excludes only bounded native zero padding and retires the structural buffer view', async () => {
	const { file, channels } = nativePafFixture(), native = nativeBuffer(channels), encoded = await file.arrayBuffer();
	const view = normalizeNativeContainerAudio(native, null, encoded);
	assert.equal(view.length, 4800); assert.equal(view.duration, .1);
	assert.equal(isNativeContainerAudioView(view), true); assert.equal(isNativeContainerAudioView(native), false);
	for (let channel = 0; channel < 2; channel++) assertPcmSamplesEqual(view.getChannelData(channel), channels[channel]!);
	const exact = nativeBuffer(channels, 4800); assert.ok(normalizeNativeContainerAudio(exact, null, encoded) === exact);
});

test('native PARIS nonzero or unexplained endpoint and foreign geometry are refused', async () => {
	const { file, channels } = nativePafFixture(), encoded = await file.arrayBuffer();
	const nonzero = nativeBuffer(channels); nonzero.getChannelData(0)[4800] = .1;
	for (const decoded of [nonzero, nativeBuffer(channels, 5824), nativeBuffer(channels, 4799), nativeBuffer(channels, 5120, 44_100), nativeBuffer(channels.slice(0, 1))]) {
		assert.throws(() => normalizeNativeContainerAudio(decoded, null, encoded), /geometry|padding/u);
	}
});

test('PARIS fixed header authority respects byte views and nonstructural recording-source fields', async () => {
	const bytes = new Uint8Array(await nativePafFixture().file.arrayBuffer()), backing = new Uint8Array(bytes.length + 17);
	backing.set(bytes, 9);
	assert.deepEqual(inspectPafPcmSourceGeometry(backing.subarray(9, 9 + bytes.length)), { sampleRate: 48_000, channelCount: 2, frameCount: 4800 });
	for (const source of [0, 1, 2, 3, 5]) {
		new DataView(bytes.buffer).setUint32(24, source, false);
		assert.equal(inspectDecodedAudioSampleRate(bytes), 48_000);
	}
});

test('unqualified encodings, versions, byte orders, widths and incomplete PARIS payloads do not claim geometry', async () => {
	const original = new Uint8Array(await nativePafFixture().file.arrayBuffer());
	for (const [offset, value] of [[0, 0], [4, 1], [8, 1], [12, 1000], [12, 768_000], [16, 1], [16, 2], [20, 0], [20, 6]]) {
		const bytes = Uint8Array.from(original); new DataView(bytes.buffer).setUint32(offset!, value!, false);
		assert.equal(inspectEncodedAudioSampleRate(bytes), null); assert.equal(inspectDecodedAudioSampleRate(bytes), null);
	}
	const little = Uint8Array.from(original); little.set(new TextEncoder().encode('fap '));
	assert.equal(inspectDecodedAudioSampleRate(little), null);
	assert.equal(inspectDecodedAudioSampleRate(original.subarray(0, original.length - 1)), null);
	assert.equal(inspectDecodedAudioSampleRate(original.subarray(0, 2048)), null);
});
