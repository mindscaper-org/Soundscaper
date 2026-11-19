/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPcmSamplesEqual } from './helpers/assert-pcm-samples.ts';
import { inspectDecodedAudioSampleRate, inspectEncodedAudioSampleRate } from '../src/common/editor/audio-file-metadata.js';
import { isNativeContainerAudioView, normalizeNativeContainerAudio } from '../src/common/editor/controller/import/internal/native-container-audio-admission.ts';
import { libsndfileWave64Fixture } from './helpers/libsndfile-wave64-fixture.ts';
import { nativeWave64Fixture } from './helpers/native-wave64-fixture.ts';
import { inspectWave64PcmSourceGeometry } from '../src/common/editor/wave64-pcm-source-geometry.ts';

function nativeBuffer(channels: readonly Float32Array[], frames = 5120, rate = 48_000): AudioBuffer {
	const planes = channels.map(input => { const output = new Float32Array(frames); output.set(input.subarray(0, frames)); return output; });
	return { length: frames, duration: frames / rate, numberOfChannels: planes.length, sampleRate: rate,
		getChannelData: channel => planes[channel]!,
		copyFromChannel(destination, channel, offset = 0) { destination.set(planes[channel]!.subarray(offset, offset + destination.length)); },
		copyToChannel(source, channel, offset = 0) { planes[channel]!.set(source, offset); },
	};
}

test('the ordinary complete Wave64 PCM source pins its original and native decoded clock', async () => {
	const encoded = await nativeWave64Fixture().file.arrayBuffer();
	assert.equal(inspectEncodedAudioSampleRate(encoded), 48_000);
	assert.equal(inspectDecodedAudioSampleRate(encoded), 48_000);
});

test('a libsndfile Wave64 with no terminal fill retains its clock and authored exclusive end', async () => {
	const { file, frameCount, sampleRate, sampleAt } = libsndfileWave64Fixture();
	const encoded = await file.arrayBuffer();
	assert.equal(inspectEncodedAudioSampleRate(encoded), sampleRate);
	assert.equal(inspectDecodedAudioSampleRate(encoded), sampleRate);
	const channels = [0, 1].map(channel => Float32Array.from({ length: frameCount }, (_, frame) => sampleAt(frame, channel)));
	const decoded = normalizeNativeContainerAudio(nativeBuffer(channels, 5120, sampleRate), null, encoded);
	assert.equal(decoded.length, frameCount);
	for (const [index, channel] of channels.entries()) assertPcmSamplesEqual(decoded.getChannelData(index), channel);
});

test('terminal fill cannot be partial and is required before the next Wave64 chunk', async () => {
	const { file, frameCount, sampleRate } = libsndfileWave64Fixture();
	const source = new Uint8Array(await file.arrayBuffer());
	const extraChunk = new Uint8Array(24);
	extraChunk.set(source.subarray(40, 56));
	extraChunk.set(new TextEncoder().encode('junk'));
	new DataView(extraChunk.buffer).setBigUint64(16, 24n, true);
	for (const [padBytes, trailingChunk] of [[0, extraChunk], [2, new Uint8Array()], [4, extraChunk]] as const) {
		const bytes = new Uint8Array(source.length + padBytes + trailingChunk.length);
		bytes.set(source);
		bytes.set(trailingChunk, source.length + padBytes);
		new DataView(bytes.buffer).setBigUint64(16, BigInt(bytes.length), true);
		assert.deepEqual(inspectWave64PcmSourceGeometry(bytes), padBytes === 4 ? { frameCount, sampleRate, channelCount: 2 } : null);
	}
});

test('Wave64 canonical storage consumes only authored PCM, keeping a padded native buffer out of the resident cache', async () => {
	const { file, channels } = nativeWave64Fixture(), original = nativeBuffer(channels);
	const view = normalizeNativeContainerAudio(original, null, await file.arrayBuffer());
	assert.equal(view.length, 4800); assert.equal(view.duration, .1);
	assert.equal(isNativeContainerAudioView(view), true); assert.equal(isNativeContainerAudioView(original), false);
	for (let channel = 0; channel < 2; channel++) assertPcmSamplesEqual(view.getChannelData(channel), channels[channel]!);
	const copied = new Float32Array(3).fill(-99); view.copyFromChannel(copied, 1, 4799);
	assert.equal(copied[0], channels[1]![4799]); assert.deepEqual([...copied.subarray(1)], [-99, -99]);
	const exact = nativeBuffer(channels, 4800);
	assert.ok(normalizeNativeContainerAudio(exact, null, await file.arrayBuffer()) === exact);
});

test('nonzero, short, excessive or foreign native Wave64 geometry cannot be silently trimmed', async () => {
	const { file, channels } = nativeWave64Fixture(), encoded = await file.arrayBuffer();
	const nonzero = nativeBuffer(channels); nonzero.getChannelData(1)[4800] = .1;
	for (const buffer of [nonzero, nativeBuffer(channels, 4799), nativeBuffer(channels, 5824), nativeBuffer(channels, 5120, 44_100), nativeBuffer(channels.slice(0, 1))]) {
		assert.throws(() => normalizeNativeContainerAudio(buffer, null, encoded), /geometry|padding/u);
	}
	assert.equal(normalizeNativeContainerAudio(nativeBuffer(channels, 5823), null, encoded).length, 4800);
});

test('Wave64 header authority respects view offsets, complete optional chunks and PCM extension padding', async () => {
	const source = new Uint8Array(await nativeWave64Fixture().file.arrayBuffer());
	const backing = new Uint8Array(source.length + 17); backing.set(source, 9);
	assert.deepEqual(inspectWave64PcmSourceGeometry(backing.subarray(9, 9 + source.length)), { sampleRate: 48_000, channelCount: 2, frameCount: 4800 });
	const unknown = new Uint8Array(source.length + 24); unknown.set(source.subarray(0, 40));
	unknown.set(source.subarray(40, 56), 40); unknown.set(new TextEncoder().encode('junk'), 40);
	new DataView(unknown.buffer).setBigUint64(56, 24n, true); unknown.set(source.subarray(40), 64);
	new DataView(unknown.buffer).setBigUint64(16, BigInt(unknown.length), true);
	assert.equal(inspectDecodedAudioSampleRate(unknown), 48_000);
	const extended = new Uint8Array(source.length + 8); extended.set(source.subarray(0, 80)); extended.set(source.subarray(80), 88);
	new DataView(extended.buffer).setBigUint64(16, BigInt(extended.length), true);
	new DataView(extended.buffer).setBigUint64(56, 42n, true);
	assert.equal(inspectDecodedAudioSampleRate(extended), 48_000);
});

test('ambiguous, malformed and unqualified Wave64 headers cannot claim clock or endpoint authority', async () => {
	const original = new Uint8Array(await nativeWave64Fixture().file.arrayBuffer());
	const changes: ReadonlyArray<(bytes: Uint8Array<ArrayBuffer>, view: DataView) => void> = [
		bytes => { bytes[15] = 1; }, bytes => { bytes[24] = 65; }, bytes => { bytes[55] = 0; },
		(_bytes, view) => { view.setBigUint64(16, BigInt(original.length - 1), true); },
		(_bytes, view) => { view.setBigUint64(56, 23n, true); },
		(_bytes, view) => { view.setBigUint64(96, 0xffff_ffff_ffff_ffffn, true); },
		(_bytes, view) => { view.setUint16(64, 3, true); }, (_bytes, view) => { view.setUint16(66, 6, true); },
		(_bytes, view) => { view.setUint32(68, 1000, true); }, (_bytes, view) => { view.setUint32(72, 0, true); },
		(_bytes, view) => { view.setUint16(76, 2, true); }, (_bytes, view) => { view.setUint16(78, 24, true); },
		(_bytes, view) => { view.setBigUint64(96, 19_223n, true); },
	];
	for (const change of changes) {
		const bytes = Uint8Array.from(original); change(bytes, new DataView(bytes.buffer));
		assert.equal(inspectEncodedAudioSampleRate(bytes), null); assert.equal(inspectDecodedAudioSampleRate(bytes), null);
	}
	const duplicated = new Uint8Array(original.length + 40); duplicated.set(original); duplicated.set(original.subarray(40, 80), original.length);
	new DataView(duplicated.buffer).setBigUint64(16, BigInt(duplicated.length), true);
	assert.equal(inspectDecodedAudioSampleRate(duplicated), null);
	assert.equal(inspectDecodedAudioSampleRate(original.subarray(0, original.length - 1)), null);
});
