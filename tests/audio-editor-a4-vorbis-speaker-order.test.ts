/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeNativeContainerAudio, isNativeContainerAudioView } from '../src/common/editor/controller/import/internal/native-container-audio-admission.ts';
import { canonicalVorbisSamples } from '../src/common/editor/browser-vorbis-decoder.ts';
import type { BrowserContainerAudioSample } from '../src/common/editor/browser-container-audio-decode.ts';
import { surroundVorbisFixture } from './helpers/surround-vorbis-fixture.ts';

const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
const CANONICAL = [0, 2, 1, 5, 3, 4];
async function backend<Value>(userAgent: string, operation: () => Promise<Value>): Promise<Value> {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent } });
	try { return await operation(); } finally {
		if (previous) Object.defineProperty(globalThis, 'navigator', previous);
		else Reflect.deleteProperty(globalThis, 'navigator');
	}
}
function nativeBuffer(channelCount = 6): AudioBuffer {
	const channels = Array.from({ length: channelCount }, (_, channel) => Float32Array.of(channel + .125, channel + .5));
	return { length: 2, duration: 2 / 48_000, sampleRate: 48_000, numberOfChannels: channelCount,
		getChannelData: channel => { assert.ok(channels[channel]); return channels[channel]!; },
		copyFromChannel(destination, channel, start = 0) { destination.set(channels[channel]!.subarray(start, start + destination.length)); },
		copyToChannel(source, channel, start = 0) { channels[channel]!.set(source, start); },
	};
}

test('generic native Vorbis import changes encoded six-channel planes to canonical speaker order', async () => backend(FIREFOX, async () => {
	const encoded = await surroundVorbisFixture(6).arrayBuffer(), native = nativeBuffer();
	const view = normalizeNativeContainerAudio(native, null, encoded);
	assert.equal(isNativeContainerAudioView(view), true); assert.equal(isNativeContainerAudioView(native), false);
	assert.deepEqual(CANONICAL.map((_, channel) => view.getChannelData(channel)[0]), CANONICAL.map(channel => channel + .125));
	assert.equal(view.length, native.length); assert.equal(view.duration, native.duration); assert.equal(view.sampleRate, native.sampleRate);
	for (const [channel, source] of CANONICAL.entries()) assert.ok(view.getChannelData(channel) === native.getChannelData(source));
	const destination = new Float32Array(1); view.copyFromChannel(destination, 3, 1); assert.equal(destination[0], 5.5);
	view.copyToChannel(Float32Array.of(.75), 4, 1); assert.equal(native.getChannelData(3)[1], .75);
	assert.throws(() => view.getChannelData(6));
}));


test('other native backends, widths and codec headers keep their original channel authority', async () => {
	const encoded = await surroundVorbisFixture(6).arrayBuffer(), native = nativeBuffer();
	for (const userAgent of [
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.4 Safari/605.1.15',
		FIREFOX.replace('X11; Linux x86_64', 'Android; Mobile'), '',
	]) await backend(userAgent, async () => { assert.ok(normalizeNativeContainerAudio(native, null, encoded) === native); });
	await backend(FIREFOX, async () => {
		assert.equal(normalizeNativeContainerAudio(nativeBuffer(2), null, encoded).numberOfChannels, 2);
		for (const offset of [0, 4, 5, 26, 27, 28, 29, 35, 39, 40]) {
			const changed = encoded.slice(0); new Uint8Array(changed)[offset]! ^= 1;
			assert.ok(normalizeNativeContainerAudio(native, null, changed) === native);
		}
		assert.ok(normalizeNativeContainerAudio(native, null, encoded.slice(0, 57)) === native);
		assert.ok(normalizeNativeContainerAudio(native, null) === native);
	});
});

test('packet normalization preserves window geometry and original sample/iterator ownership', async () => backend(FIREFOX, async () => {
	let closed = 0, retired = false;
	const sample: BrowserContainerAudioSample = {
		timestamp: .25, duration: 3 / 48_000, sampleRate: 48_000, numberOfChannels: 6, numberOfFrames: 3,
		copyTo(destination, options) {
			const values = Float32Array.of(options.planeIndex, options.planeIndex + .25, options.planeIndex + .5);
			destination.set(values.subarray(options.frameOffset ?? 0, (options.frameOffset ?? 0) + (options.frameCount ?? 3)));
		}, close() { closed++; },
	};
	const source = { async *[Symbol.asyncIterator]() { try { yield sample; } finally { retired = true; } } };
	const iterator = canonicalVorbisSamples(source, 6)[Symbol.asyncIterator](), next = await iterator.next();
	assert.equal(next.done, false); if (next.done) throw new Error('The source sample is required.');
	const view = next.value;
	assert.equal(view.timestamp, .25); assert.equal(view.duration, sample.duration); assert.equal(view.numberOfFrames, 3);
	assert.equal(view.sampleRate, 48_000); assert.equal(view.numberOfChannels, 6); assert.equal(closed, 0);
	for (const [channel, plane] of CANONICAL.entries()) {
		const destination = new Float32Array(2);
		view.copyTo(destination, { planeIndex: channel, format: 'f32-planar', frameOffset: 1, frameCount: 2 });
		assert.deepEqual([...destination], [plane + .25, plane + .5]);
	}
	view.close(); await iterator.return?.(); assert.equal(closed, 1); assert.equal(retired, true);
	assert.ok(canonicalVorbisSamples(source, 2) === source);
}));

test('packet normalization retains unsupported width validation and upstream failures', async () => backend(FIREFOX, async () => {
	const failure = new DOMException('Decode retired', 'AbortError');
	const source = { async *[Symbol.asyncIterator](): AsyncGenerator<BrowserContainerAudioSample> { yield await Promise.reject<BrowserContainerAudioSample>(failure); } };
	await assert.rejects(async () => { for await (const sample of canonicalVorbisSamples(source, 6)) sample.close(); }, error => error === failure);
}));
