/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPcmSamplesEqual } from './helpers/assert-pcm-samples.ts';
import { inspectDecodedAudioSampleRate, inspectEncodedAudioSampleRate } from '../src/common/editor/audio-file-metadata.js';
import { isNativeContainerAudioView, normalizeNativeContainerAudio } from '../src/common/editor/controller/import/internal/native-container-audio-admission.ts';
import { nativeNistFixture } from './helpers/native-nist-fixture.ts';
import { inspectNistPcmSourceGeometry } from '../src/common/editor/nist-pcm-source-geometry.ts';

async function rewriteHeader(change: (text: string) => string, size = 1024): Promise<Uint8Array<ArrayBuffer>> {
	const original = new Uint8Array(await nativeNistFixture().file.arrayBuffer());
	const header = new TextDecoder().decode(original.subarray(16, 1024)).split('\nend_head\n')[0]!;
	const text = new TextEncoder().encode(`NIST_1A\n${String(size).padStart(7, ' ')}\n${change(header)}\nend_head\n`);
	assert.ok(text.length <= size);
	const result = new Uint8Array(size + original.length - 1024); result.set(text); result.set(original.subarray(1024), size);
	return result;
}

function nativeBuffer(channels: readonly Float32Array[], frames = 5120, rate = 48_000): AudioBuffer {
	const planes = channels.map(input => { const output = new Float32Array(frames); output.set(input.subarray(0, frames)); return output; });
	return { length: frames, duration: frames / rate, numberOfChannels: planes.length, sampleRate: rate,
		getChannelData: channel => planes[channel]!,
		copyFromChannel(destination, channel, offset = 0) { destination.set(planes[channel]!.subarray(offset, offset + destination.length)); },
		copyToChannel(source, channel, offset = 0) { planes[channel]!.set(source, offset); },
	};
}

test('the ordinary complete NIST/SPHERE PCM source pins its source and native decoded clock', async () => {
	const encoded = await nativeNistFixture().file.arrayBuffer();
	assert.equal(inspectEncodedAudioSampleRate(encoded), 48_000); assert.equal(inspectDecodedAudioSampleRate(encoded), 48_000);
});

test('NIST canonical PCM stops at its declared sample count and cannot enter the native resident cache as a structural view', async () => {
	const { file, channels } = nativeNistFixture(), native = nativeBuffer(channels);
	const view = normalizeNativeContainerAudio(native, null, await file.arrayBuffer());
	assert.equal(view.length, 4800); assert.equal(view.duration, .1);
	assert.equal(isNativeContainerAudioView(view), true); assert.equal(isNativeContainerAudioView(native), false);
	for (let channel = 0; channel < 2; channel++) assertPcmSamplesEqual(view.getChannelData(channel), channels[channel]!);
	const exact = nativeBuffer(channels, 4800); assert.ok(normalizeNativeContainerAudio(exact, null, await file.arrayBuffer()) === exact);
});

test('nonzero or unexplained native NIST endpoint and foreign geometry are refused', async () => {
	const { file, channels } = nativeNistFixture(), encoded = await file.arrayBuffer();
	const nonzero = nativeBuffer(channels); nonzero.getChannelData(0)[4800] = .1;
	for (const decoded of [nonzero, nativeBuffer(channels, 5824), nativeBuffer(channels, 4799), nativeBuffer(channels, 5120, 44_100), nativeBuffer(channels.slice(0, 1))]) {
		assert.throws(() => normalizeNativeContainerAudio(decoded, null, encoded), /geometry|padding/u);
	}
});

test('NIST authority preserves bounded header order, extension metadata, optional precision and view offsets', async () => {
	for (const bytes of [await rewriteHeader(text => text.split('\n').reverse().join('\n'), 2048),
		await rewriteHeader(text => `${text}\ncomment -s8 end_head\n__proto__ -i 7\nconstructor -s3 PCM`),
		await rewriteHeader(text => text.replace('sample_sig_bits -i 16\n', '')),
		await rewriteHeader(text => text.replace('sample_byte_format -s2 01', 'sample_byte_format -s2 10'))]) {
		const backing = new Uint8Array(bytes.length + 17); backing.set(bytes, 9);
		assert.deepEqual(inspectNistPcmSourceGeometry(backing.subarray(9, 9 + bytes.length)), { sampleRate: 48_000, channelCount: 2, frameCount: 4800 });
	}
});

test('malformed, compressed, ambiguous or incomplete NIST headers cannot claim source geometry', async () => {
	const changes: ReadonlyArray<(text: string) => string> = [
		text => `${text}\nsample_rate -i 48000`, text => text.replace('sample_rate -i 48000', 'sample_rate -r 48000'),
		text => text.replace('sample_rate -i 48000', 'sample_rate -i 1000'),
		text => text.replace('channel_count -i 2', 'channel_count -i 6'),
		text => text.replace('sample_count -i 4800', 'sample_count -i 4801'),
		text => text.replace('sample_count -i 4800', 'sample_count -i -4800'),
		text => text.replace('sample_count -i 4800', 'sample_count -i 9007199254740992'),
		text => text.replace('sample_n_bytes -i 2', 'sample_n_bytes -i 3'),
		text => text.replace('sample_sig_bits -i 16', 'sample_sig_bits -i 24'),
		text => text.replace('sample_coding -s3 pcm', 'sample_coding -s4 ulaw'),
		text => text.replace('sample_coding -s3 pcm', 'sample_coding -s4 pcm'),
		text => text.replace('sample_byte_format -s2 01', 'sample_byte_format -s2 11'),
		text => `${text}\nuntyped invalid`, text => text.replace('sample_rate -i 48000\n', ''),
	];
	for (const change of changes) {
		const bytes = await rewriteHeader(change);
		assert.equal(inspectEncodedAudioSampleRate(bytes), null); assert.equal(inspectDecodedAudioSampleRate(bytes), null);
	}
	const excessFields = await rewriteHeader(text => `${text}\n${Array.from({ length: 257 }, (_, index) => `field_${index} -i 0`).join('\n')}`, 8192);
	assert.equal(inspectNistPcmSourceGeometry(excessFields), null);
	const original = new Uint8Array(await nativeNistFixture().file.arrayBuffer());
	assert.equal(inspectDecodedAudioSampleRate(original.subarray(0, original.length - 1)), null);
	const changed = Uint8Array.from(original); changed[7] = 13;
	assert.equal(inspectDecodedAudioSampleRate(changed), null);
});
