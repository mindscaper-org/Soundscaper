/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPcmSamplesEqual } from './helpers/assert-pcm-samples.ts';
import { normalizeNativeContainerAudio, isNativeContainerAudioView } from '../src/common/editor/controller/import/internal/native-container-audio-admission.ts';
import { nativeMsAdpcmFixture } from './helpers/native-ms-adpcm-fixture.ts';

function nativeBuffer(channels: readonly Float32Array[], rate = 48_000): AudioBuffer {
	const planes = channels.map(channel => channel.slice()), length = planes[0]!.length;
	return { length, duration: length / rate, sampleRate: rate, numberOfChannels: planes.length,
		getChannelData: channel => planes[channel]!,
		copyFromChannel(destination, channel, start = 0) { destination.set(planes[channel]!.subarray(start, start + destination.length)); },
		copyToChannel(source, channel, start = 0) { planes[channel]!.set(source, start); },
	};
}

test('ordinary MS ADPCM retains its authored fact extent instead of the padded final block', async () => {
	const { file, channels, decodedFrames } = nativeMsAdpcmFixture();
	assert.equal(decodedFrames, 6108);
	const original = nativeBuffer(channels), normalized = normalizeNativeContainerAudio(original, null, await file.arrayBuffer());
	assert.equal(normalized.length, 4800); assert.equal(normalized.duration, .1);
	assert.equal(isNativeContainerAudioView(normalized), true);
	for (let channel = 0; channel < 2; channel++) assertPcmSamplesEqual(normalized.getChannelData(channel), channels[channel]!.subarray(0, 4800));
});

test('standard MS ADPCM fact authority authenticates complete bytes, block capacity and profile', async () => {
	const { inspectWavAdpcmSourceGeometry } = await import('../src/common/editor/wav-adpcm-source-geometry.ts');
	const bytes = new Uint8Array(await nativeMsAdpcmFixture().file.arrayBuffer());
	const expected = { sampleRate: 48_000, channelCount: 2, frameCount: 4800, decodedFrameCount: 6108 };
	assert.deepEqual(inspectWavAdpcmSourceGeometry(bytes), expected);
	const offset = new Uint8Array(bytes.length + 13); offset.set(bytes, 7);
	assert.deepEqual(inspectWavAdpcmSourceGeometry(offset.subarray(7, 7 + bytes.length)), expected);
	const optional = new Uint8Array(bytes.length + 10); optional.set(bytes.subarray(0, 12));
	optional.set(new TextEncoder().encode('JUNK'), 12); new DataView(optional.buffer).setUint32(16, 1, true);
	optional.set(bytes.subarray(12), 22); new DataView(optional.buffer).setUint32(4, optional.length - 8, true);
	assert.deepEqual(inspectWavAdpcmSourceGeometry(optional), expected);
	const changes: ReadonlyArray<(bytes: Uint8Array<ArrayBuffer>, view: DataView) => void> = [
		value => { value[0] = 0; }, (_value, view) => { view.setUint32(4, bytes.length - 9, true); },
		(_value, view) => { view.setUint16(20, 17, true); }, (_value, view) => { view.setUint16(22, 3, true); },
		(_value, view) => { view.setUint32(24, 1000, true); }, (_value, view) => { view.setUint32(28, 0, true); },
		(_value, view) => { view.setUint16(32, 2047, true); }, (_value, view) => { view.setUint16(34, 8, true); },
		(_value, view) => { view.setUint16(36, 0, true); }, (_value, view) => { view.setUint16(38, 2037, true); },
		(_value, view) => { view.setUint16(40, 6, true); }, value => { value[42] = 1; },
		(_value, view) => { view.setUint32(78, 0, true); }, (_value, view) => { view.setUint32(78, 6109, true); },
		(_value, view) => { view.setUint32(78, 4072, true); }, (_value, view) => { view.setUint32(86, 6143, true); },
		value => { value.set(new TextEncoder().encode('JUNK'), 70); },
	];
	for (const change of changes) {
		const invalid = Uint8Array.from(bytes); change(invalid, new DataView(invalid.buffer));
		assert.equal(inspectWavAdpcmSourceGeometry(invalid), null);
	}
	for (const end of [0, 11, 89, bytes.length - 1]) assert.equal(inspectWavAdpcmSourceGeometry(bytes.subarray(0, end)), null);
	for (const chunk of [bytes.subarray(12, 70), bytes.subarray(70, 82), bytes.subarray(82)]) {
		const duplicate = new Uint8Array(bytes.length + chunk.length); duplicate.set(bytes); duplicate.set(chunk, bytes.length);
		new DataView(duplicate.buffer).setUint32(4, duplicate.length - 8, true);
		assert.equal(inspectWavAdpcmSourceGeometry(duplicate), null);
	}
});

test('ADPCM normalization preserves exact native buffers and refuses incompatible decoded geometry', async () => {
	const { file, channels } = nativeMsAdpcmFixture(), bytes = await file.arrayBuffer();
	const exact = nativeBuffer(channels.map(channel => channel.subarray(0, 4800)));
	assert.ok(normalizeNativeContainerAudio(exact, null, bytes) === exact);
	assert.equal(isNativeContainerAudioView(exact), false);
	for (const buffer of [nativeBuffer(channels, 44_100), nativeBuffer(channels.slice(0, 1)),
		nativeBuffer(channels.map(channel => channel.subarray(0, 4799))), nativeBuffer(channels.map(channel => channel.subarray(0, 5000)))]) {
		assert.throws(() => normalizeNativeContainerAudio(buffer, null, bytes), /geometry/u);
	}
	const unsupported = bytes.slice(0); new DataView(unsupported).setUint16(20, 17, true);
	const original = nativeBuffer(channels); assert.ok(normalizeNativeContainerAudio(original, null, unsupported) === original);
});
