/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeBrowserContainerAudio } from '../src/common/editor/browser-container-audio-decode.ts';
import { opusPaddingAvFixture, surroundAvWebmFixture } from './helpers/ordinary-ogg-opus-fixture.ts';
import { hasReviewedContainerOpusPreSkip, preferContainerOpusPreSkipDecoder } from '../src/common/editor/browser-container-opus-decoder.ts';

test('bounded video audio uses proven Opus pre-skip rather than a native support advertisement', async () => {
	const originalDecoder = globalThis.AudioDecoder, originalFetch = globalThis.fetch;
	let nativeOpened = 0;
	class AdvertisedDecoder {
		static isConfigSupported(config: AudioDecoderConfig) { return Promise.resolve({ supported: true, config }); }
		constructor() { nativeOpened++; throw new Error('Native support does not prove correct Opus pre-skip.'); }
	}
	globalThis.AudioDecoder = AdvertisedDecoder as unknown as typeof AudioDecoder;
	globalThis.fetch = async (url) => { assert.ok(url instanceof URL); return new Response(Uint8Array.from(await readFile(url))); };
	try {
		const decoded = await decodeBrowserContainerAudio(opusPaddingAvFixture(), { durationSeconds: .3 });
		assert.equal(decoded.sampleRate, 48_000); assert.equal(decoded.frameCount, 14_400); assert.equal(decoded.channels.length, 1);
		const pcm = decoded.channels[0]!;
		let squareError = 0;
		for (let frame = 1000; frame < 4200; frame++) squareError += (pcm[frame]! - .2 * Math.sin(2 * Math.PI * 997 * (frame + 336) / 48_000)) ** 2;
		assert.ok(squareError / 3200 < .0005, 'Codec pre-skip cannot shift the authored programme.');
		assert.ok(pcm.slice(4464).every(value => value === 0), 'Only authored audio precedes the remaining picture horizon.');
		assert.equal(nativeOpened, 0);
	} finally { globalThis.AudioDecoder = originalDecoder; globalThis.fetch = originalFetch; }
});

test('native surround Opus keeps its existing decoder rather than entering the stereo-only reviewed ABI', async () => {
	const originalDecoder = globalThis.AudioDecoder, originalFetch = globalThis.fetch;
	let nativeOpened = 0;
	class AdvertisedDecoder {
		static isConfigSupported(config: AudioDecoderConfig) { return Promise.resolve({ supported: true, config }); }
		constructor() { nativeOpened++; throw new Error('Native surround control.'); }
	}
	globalThis.AudioDecoder = AdvertisedDecoder as unknown as typeof AudioDecoder;
	globalThis.fetch = () => { throw new Error('The stereo-only reviewed payload cannot own surround.'); };
	try {
		await assert.rejects(decodeBrowserContainerAudio(await surroundAvWebmFixture(), { durationSeconds: .12 }), /Native surround control/u);
		assert.equal(nativeOpened, 1);
	} finally { globalThis.AudioDecoder = originalDecoder; globalThis.fetch = originalFetch; }
});

test('the reviewed profile respects description view offsets and leaves other native Opus headers unchanged', () => {
	const backing = new Uint8Array(25), head = backing.subarray(3, 22);
	head.set(new TextEncoder().encode('OpusHead')); head[8] = 1; head[9] = 2; head[10] = 56; head[11] = 1;
	const config = { codec: 'opus', sampleRate: 48_000, numberOfChannels: 2, description: head };
	assert.equal(hasReviewedContainerOpusPreSkip(config), true);
	head[18] = 1; assert.equal(hasReviewedContainerOpusPreSkip(config), false);
	head[18] = 0; head[10] = 0; head[11] = 0; assert.equal(hasReviewedContainerOpusPreSkip(config), false);
	head[10] = 1; head[8] = 2; assert.equal(hasReviewedContainerOpusPreSkip(config), false);
});

test('a retired decoder description cannot install a late preferred configuration', async () => {
	const abort = new AbortController();
	let resolve: ((value: AudioDecoderConfig | null) => void) | undefined;
	const pending = new Promise<AudioDecoderConfig | null>(done => { resolve = done; });
	const original = () => pending, track = { getDecoderConfig: original };
	const operation = preferContainerOpusPreSkipDecoder(track, abort.signal);
	const reason = new DOMException('Retire video import.', 'AbortError'); abort.abort(reason); resolve?.(null);
	await assert.rejects(operation, error => error === reason);
	assert.equal(track.getDecoderConfig, original);
});
