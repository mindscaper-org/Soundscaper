/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ADTS, BlobSource, Input } from 'mediabunny';
import { createNativeStreamedAacImport, primeNativeStreamedAacImport } from '../src/common/editor/browser-native-streamed-aac-import.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import type { BrowserContainerAudioSample } from '../src/common/editor/browser-container-audio-decode.ts';
import { implicitAacFixture } from './helpers/implicit-sbr-aac-fixture.ts';

test('ordinary FDK-AAC files preserve core declarations and independent reconstructed frame extents', async () => {
	for (const profile of ['he', 'ps', 'lc'] as const) {
		const { file, channels, frameCount } = implicitAacFixture(profile);
		assert.equal(channels.length, 2); assert.equal(frameCount, profile === 'he' ? 10_240 : profile === 'ps' ? 12_288 : 7168);
		const input = new Input({ source: new BlobSource(file), formats: [ADTS] });
		try {
			const track = await input.getPrimaryAudioTrack(); assert.ok(track);
			assert.equal(await track.getSampleRate(), profile === 'lc' ? 48_000 : 24_000);
			assert.equal(await track.getNumberOfChannels(), profile === 'ps' ? 1 : 2);
			assert.equal(Math.round(await track.computeDuration() * 48_000), frameCount);
		} finally { input.dispose(); }
	}
});

function fixture(options: { coreRate?: number; coreChannels?: number; rate?: number; channels?: number; implicit?: boolean; changedSecond?: boolean; signal?: AbortSignal; packetCount?: number; heldOutputs?: boolean } = {}) {
	const coreRate = options.coreRate ?? 24_000, coreChannels = options.coreChannels ?? 2;
	const rate = options.rate ?? 48_000, channels = options.channels ?? 2, closed = new Set<number>();
	let output: AudioDecoderInit['output']; let decoded = 0; let decoderClosed = 0; let read = 0;
	const session = createNativeStreamedAacImport({ config: { codec: 'mp4a.40.2', sampleRate: coreRate, numberOfChannels: coreChannels },
		...{ allowImplicitSbr: options.implicit !== false },
		...(options.signal ? { signal: options.signal } : {}),
		packets: async function* () { for (let index = 0; index < (options.packetCount ?? 2); index++) { read++;
			yield { data: new Uint8Array(10), byteLength: 10, type: 'key' as const, timestamp: index * 1024 / coreRate, duration: 1024 / coreRate }; } },
		createChunk: settings => ({ timestamp: settings.timestamp } as EncodedAudioChunk),
		createDecoder(init) { output = init.output; return {
			decodeQueueSize: 0, configure() {}, addEventListener() {}, removeEventListener() {},
			decode() { const index = decoded++; if (!options.heldOutputs) queueMicrotask(() => { output({ timestamp: index } as AudioData); }); },
			async flush() {}, close() { decoderClosed++; },
		}; },
		wrapSample(data): BrowserContainerAudioSample {
			const index = data.timestamp, actualRate = options.changedSecond && index === 1 ? rate / 2 : rate;
			const numberOfFrames = 1024 * actualRate / coreRate;
			return { timestamp: index * 1024 / coreRate, sampleRate: actualRate, numberOfChannels: channels,
				numberOfFrames, duration: numberOfFrames / actualRate,
				copyTo(destination, settings) { destination.fill((settings.planeIndex + 1) / 10); }, close() { closed.add(index); } };
		},
	});
	return { session, closed, get decoderClosed() { return decoderClosed; }, get read() { return read; } };
}

for (const coreChannels of [1, 2]) test(`ADTS learns48k/2ch reconstructed PCM from24k/${coreChannels}ch implicit SBR/PS`, async () => {
	const current = fixture({ coreChannels }); let frames = 0;
	for await (const sample of current.session.samples()) {
		assert.equal(sample.sampleRate, 48_000); assert.equal(sample.numberOfChannels, 2);
		frames += sample.numberOfFrames;
	}
	assert.equal(frames, 4096); assert.equal(current.closed.size, 2); assert.equal(current.decoderClosed, 1);
});

test('ordinary AAC-LC retains its declared clock and width while probing ADTS output', async () => {
	const current = fixture({ coreRate: 48_000, rate: 48_000, packetCount: 81 }); let frames = 0;
	for await (const sample of current.session.samples()) frames += sample.numberOfFrames;
	assert.equal(frames, 81 * 1024); assert.equal(current.closed.size, 81);
});

test('unobserved SBR output reserves the doubled frame budget before another native packet is submitted', async () => {
	const current = fixture({ packetCount: 81, heldOutputs: true });
	await assert.rejects(current.session.samples().next(), /sample geometry/u);
	assert.equal(current.read, 33); assert.equal(current.decoderClosed, 1);
});

for (const options of [{ implicit: false }, { rate: 96_000 }, { channels: 6 }, { coreChannels: 2, channels: 1 },
	{ coreRate: 48_000, rate: 48_000, coreChannels: 1, channels: 2 }, { changedSecond: true }]) {
	test(`unqualified or changing native AAC geometry remains refused: ${JSON.stringify(options)}`, async () => {
		const current = fixture(options);
		await assert.rejects(async () => { for await (const _sample of current.session.samples()) { /* Drain owned samples. */ } }, /sample geometry/u);
		assert.equal(current.decoderClosed, 1); assert.ok(current.closed.size > 0);
	});
}

test('primed reconstructed geometry precedes canonical storage without dropping the owned first frame', async () => {
	const current = fixture({ coreChannels: 1 });
	const primed = await primeNativeStreamedAacImport(current.session);
	assert.equal(primed.sampleRate, 48_000); assert.equal(primed.channelCount, 2); assert.equal(current.closed.size, 0);
	const prepared = await prepareStreamedAudioImport(new Blob(['aac']), { openSession: async () => ({ ...primed,
		timelineOrigin: 0, durationSeconds: 2048 / 24_000, continuousTimeline: true,
	}) });
	assert.deepEqual(prepared.descriptor, { container: 'compressed-audio', sampleRate: 48_000, channelCount: 2, frameCount: 4096, mimeType: 'audio/mpeg' });
	let frames = 0;
	await prepared.stream({ chunkFrames: 1024, onChunk(channels) {
		frames += channels[0]!.length; assert.ok(channels[0]!.every(value => Math.abs(value - .1) < 1e-7));
		assert.ok(channels[1]!.every(value => Math.abs(value - .2) < 1e-7));
	} });
	assert.equal(frames, 4096); assert.equal(current.closed.size, 2); assert.equal(current.decoderClosed, 1);
});

test('abandoning the primed first frame closes it and retires the decoder before streaming', async () => {
	const current = fixture(); const primed = await primeNativeStreamedAacImport(current.session);
	primed.dispose(); primed.dispose();
	assert.ok(current.closed.has(0)); assert.equal(current.decoderClosed, 1);
	await assert.rejects(primed.samples().next(), /closed/u);
});

test('external cancellation after first-frame admission cannot publish that retained frame', async () => {
	const controller = new AbortController(), current = fixture({ signal: controller.signal });
	const primed = await primeNativeStreamedAacImport(current.session, controller.signal);
	const reason = new DOMException('Retire AAC import.', 'AbortError'); controller.abort(reason);
	await assert.rejects(primed.samples().next(), error => error === reason);
	assert.ok(current.closed.has(0)); assert.equal(current.decoderClosed, 1);
});
