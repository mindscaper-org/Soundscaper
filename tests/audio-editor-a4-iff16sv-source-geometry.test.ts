/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectDecodedAudioSampleRate, inspectEncodedAudioSampleRate } from '../src/common/editor/audio-file-metadata.js';
import { isNativeContainerAudioView, normalizeNativeContainerAudio } from '../src/common/editor/controller/import/internal/native-container-audio-admission.ts';
import { nativeIff16svFixture } from './helpers/native-iff16sv-fixture.ts';
import { inspectIff16svPcmSourceGeometry } from '../src/common/editor/iff16sv-pcm-source-geometry.ts';

function nativeBuffer(channels: readonly Float32Array[], frames = 5120, rate = 48_000): AudioBuffer {
	const planes = channels.map(input => { const output = new Float32Array(frames); output.set(input.subarray(0, frames)); return output; });
	return { length: frames, duration: frames / rate, numberOfChannels: planes.length, sampleRate: rate,
		getChannelData: channel => planes[channel]!,
		copyFromChannel(destination, channel, offset = 0) { destination.set(planes[channel]!.subarray(offset, offset + destination.length)); },
		copyToChannel(source, channel, offset = 0) { planes[channel]!.set(source, offset); },
	};
}

test('ordinary complete IFF16SV PCM16 source pins its original and native decoded clock', async () => {
	const encoded = await nativeIff16svFixture().file.arrayBuffer();
	assert.equal(inspectEncodedAudioSampleRate(encoded), 48_000); assert.equal(inspectDecodedAudioSampleRate(encoded), 48_000);
});

test('IFF16SV canonical storage excludes only bounded native zero padding and retires the structural buffer view', async () => {
	const { file, channels } = nativeIff16svFixture(), native = nativeBuffer(channels), encoded = await file.arrayBuffer();
	const view = normalizeNativeContainerAudio(native, null, encoded);
	assert.equal(view.length, 4800); assert.equal(view.duration, .1);
	assert.equal(isNativeContainerAudioView(view), true); assert.equal(isNativeContainerAudioView(native), false);
	for (let channel = 0; channel < 1; channel++) assert.deepEqual(view.getChannelData(channel), channels[channel]);
	const exact = nativeBuffer(channels, 4800); assert.equal(normalizeNativeContainerAudio(exact, null, encoded), exact);
});

test('native IFF16SV nonzero or unexplained endpoint and foreign geometry are refused', async () => {
	const { file, channels } = nativeIff16svFixture(), encoded = await file.arrayBuffer();
	const nonzero = nativeBuffer(channels); nonzero.getChannelData(0)[4800] = .1;
	for (const decoded of [nonzero, nativeBuffer(channels, 5824), nativeBuffer(channels, 4799), nativeBuffer(channels, 5120, 44_100), nativeBuffer([channels[0]!, channels[0]!])]) {
		assert.throws(() => normalizeNativeContainerAudio(decoded, null, encoded), /geometry|padding/u);
	}
});

function form(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(12 + chunks.reduce((length, chunk) => length + chunk.length, 0));
	bytes.set(new TextEncoder().encode('FORM')); bytes.set(new TextEncoder().encode('16SV'), 8);
	new DataView(bytes.buffer).setUint32(4, bytes.length - 8, false);
	let offset = 12; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
	return bytes;
}

function chunks(bytes: Uint8Array): Uint8Array[] {
	const result: Uint8Array[] = [], view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = 12; offset < bytes.length;) {
		const size = view.getUint32(offset + 4, false), next = offset + 8 + size + (size & 1);
		result.push(bytes.slice(offset, next)); offset = next;
	}
	return result;
}

test('IFF16SV source geometry honors exact byte views, opaque odd metadata and chunk order', async () => {
	const bytes = new Uint8Array(await nativeIff16svFixture().file.arrayBuffer()), backing = new Uint8Array(bytes.length + 17);
	backing.set(bytes, 9);
	const expected = { sampleRate: 48_000, frameCount: 4800, channelCount: 1 };
	assert.deepEqual(inspectIff16svPcmSourceGeometry(backing.subarray(9, 9 + bytes.length)), expected);
	const oddMetadata = Uint8Array.from([65, 78, 78, 79, 0, 0, 0, 1, 120, 0]);
	assert.deepEqual(inspectIff16svPcmSourceGeometry(form([oddMetadata, ...chunks(bytes).reverse()])), expected);
});

test('unqualified loop, channel placement, compression, octave and inconsistent IFF extents stay native', async () => {
	const original = new Uint8Array(await nativeIff16svFixture().file.arrayBuffer());
	for (const [offset, value, width] of [[4, 0, 4], [8, 0x38535658, 4], [16, 19, 4], [20, 4799, 4], [20, 0, 4],
		[24, 1, 4], [28, 1, 4], [32, 1000, 2], [34, 2, 1], [35, 1, 1]] as const) {
		const bytes = Uint8Array.from(original), view = new DataView(bytes.buffer);
		if (width === 4) view.setUint32(offset, value, false); else if (width === 2) view.setUint16(offset, value, false); else view.setUint8(offset, value);
		assert.equal(inspectDecodedAudioSampleRate(bytes), null);
	}
	const sourceChunks = chunks(original), voice = sourceChunks[0]!, body = sourceChunks.at(-1)!;
	const channelPlacement = Uint8Array.from([67, 72, 65, 78, 0, 0, 0, 4, 0, 0, 0, 6]);
	for (const bytes of [form([voice, voice, body]), form([voice, body, body]), form([body]), form([voice]),
		form([voice, channelPlacement, body]), original.subarray(0, original.length - 1),
		form([voice, ...Array.from({ length: 4096 }, () => new Uint8Array(8)), body])]) {
		assert.equal(inspectEncodedAudioSampleRate(bytes), null); assert.equal(inspectDecodedAudioSampleRate(bytes), null);
	}
});

