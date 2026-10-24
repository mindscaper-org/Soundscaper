/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectDecodedAudioSampleRate, inspectEncodedAudioSampleRate } from '../src/common/editor/audio-file-metadata.js';
import { isNativeContainerAudioView, normalizeNativeContainerAudio } from '../src/common/editor/controller/import/internal/native-container-audio-admission.ts';
import { inspectIrcamPcmSourceGeometry } from '../src/common/editor/ircam-pcm-source-geometry.ts';
import { nativeIrcamFixture } from './helpers/native-ircam-fixture.ts';

function nativeBuffer(channels: readonly Float32Array[], frames = 5120, rate = 48_000): AudioBuffer {
	const planes = channels.map(input => { const output = new Float32Array(frames); output.set(input.subarray(0, frames)); return output; });
	return { length: frames, duration: frames / rate, numberOfChannels: planes.length, sampleRate: rate,
		getChannelData: channel => planes[channel]!,
		copyFromChannel(destination, channel, offset = 0) { destination.set(planes[channel]!.subarray(offset, offset + destination.length)); },
		copyToChannel(source, channel, offset = 0) { planes[channel]!.set(source, offset); },
	};
}

test('the ordinary complete IRCAM PCM source pins its original and native decoded clock', async () => {
	const encoded = await nativeIrcamFixture().file.arrayBuffer();
	assert.equal(inspectEncodedAudioSampleRate(encoded), 48_000);
	assert.equal(inspectDecodedAudioSampleRate(encoded), 48_000);
});

test('IRCAM canonical storage consumes only authored PCM, keeping a padded native buffer out of the resident cache', async () => {
	const { file, channels } = nativeIrcamFixture(), original = nativeBuffer(channels);
	const view = normalizeNativeContainerAudio(original, null, await file.arrayBuffer());
	assert.equal(view.length, 4800); assert.equal(view.duration, .1);
	assert.equal(isNativeContainerAudioView(view), true); assert.equal(isNativeContainerAudioView(original), false);
	for (let channel = 0; channel < 2; channel++) assert.deepEqual(view.getChannelData(channel), channels[channel]);
	const copied = new Float32Array(3).fill(-99); view.copyFromChannel(copied, 1, 4799);
	assert.equal(copied[0], channels[1]![4799]); assert.deepEqual([...copied.subarray(1)], [-99, -99]);
	const exact = nativeBuffer(channels, 4800);
	assert.equal(normalizeNativeContainerAudio(exact, null, await file.arrayBuffer()), exact);
});

test('nonzero, short, excessive or foreign native IRCAM geometry cannot be silently trimmed', async () => {
	const { file, channels } = nativeIrcamFixture(), encoded = await file.arrayBuffer();
	const nonzero = nativeBuffer(channels); nonzero.getChannelData(1)[4800] = .1;
	for (const buffer of [nonzero, nativeBuffer(channels, 4799), nativeBuffer(channels, 5824), nativeBuffer(channels, 5120, 44_100), nativeBuffer(channels.slice(0, 1))]) {
		assert.throws(() => normalizeNativeContainerAudio(buffer, null, encoded), /geometry|padding/u);
	}
	assert.equal(normalizeNativeContainerAudio(nativeBuffer(channels, 5823), null, encoded).length, 4800);
});


test('IRCAM header authority respects typed-array offsets and rejects unqualified geometry', async () => {
	const original = new Uint8Array(await nativeIrcamFixture().file.arrayBuffer());
	const backing = new Uint8Array(original.length + 18); backing.set(original, 9);
	assert.deepEqual(inspectIrcamPcmSourceGeometry(backing.subarray(9, original.length + 9)), { sampleRate: 48_000, channelCount: 2, frameCount: 4800 });
	const changes: ReadonlyArray<(bytes: Uint8Array<ArrayBuffer>, view: DataView) => void> = [
		bytes => { bytes[0] = 0; }, bytes => { bytes[2] = 2; }, bytes => { bytes[3] = 1; },
		(_bytes, view) => { view.setFloat32(4, Number.NaN, true); },
		(_bytes, view) => { view.setFloat32(4, Number.POSITIVE_INFINITY, true); },
		(_bytes, view) => { view.setFloat32(4, 48_000.5, true); },
		(_bytes, view) => { view.setFloat32(4, 0, true); },
		(_bytes, view) => { view.setFloat32(4, 400_000, true); },
		(_bytes, view) => { view.setUint32(8, 0, true); },
		(_bytes, view) => { view.setUint32(8, 6, true); },
		(_bytes, view) => { view.setUint32(12, 4, true); },
	];
	for (const change of changes) {
		const bytes = Uint8Array.from(original); change(bytes, new DataView(bytes.buffer));
		assert.equal(inspectIrcamPcmSourceGeometry(bytes), null);
	}
	for (const length of [0, 16, 1023, 1024, original.length - 1]) assert.equal(inspectIrcamPcmSourceGeometry(original.subarray(0, length)), null);
});
