/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobSource, Input, MP4 } from 'mediabunny';
import { disableReviewedAudioImportDecoders } from '../src/common/editor/browser-reviewed-streamed-audio-decoders.ts';
import { hasReviewedContainerOpusPreSkip } from '../src/common/editor/browser-container-opus-decoder.ts';
import { importAndReopenAudio } from './helpers/audio-import-archive-custody.ts';
import { gappedOpusMp4Fixture } from './helpers/gapped-opus-mp4-fixture.ts';
import { nativeOpusMp4Fixture } from './helpers/native-opus-mp4-fixture.ts';
import { createReviewedAudioCodecRuntime, useLocalAudioCodecPayloads } from './helpers/reviewed-audio-codec-runtime.ts';

for (const kind of ['origin', 'ordinary', 'subpacket'] as const) test(`real Opus MP4 ${kind} retains independent programme PCM through import and Scape`, async context => {
	useLocalAudioCodecPayloads(context);
	context.after(() => { disableReviewedAudioImportDecoders(); });
	const { file, reference } = kind === 'origin' ? nativeOpusMp4Fixture() : gappedOpusMp4Fixture(kind);
	const originalDecoder = Object.getOwnPropertyDescriptor(globalThis, 'AudioDecoder');
	let nativeConstructions = 0;
	class AdvertisedNativeDecoder {
		static async isConfigSupported(config: AudioDecoderConfig) { return { supported: true, config }; }
		constructor() { nativeConstructions++; assert.fail('This exact Opus profile must select the shipping reviewed decoder before native WebCodecs'); }
	}
	Object.defineProperty(globalThis, 'AudioDecoder', { configurable: true, value: AdvertisedNativeDecoder });
	context.after(() => {
		if (originalDecoder) Object.defineProperty(globalThis, 'AudioDecoder', originalDecoder);
		else Reflect.deleteProperty(globalThis, 'AudioDecoder');
	});
	const input = new Input({ source: new BlobSource(file), formats: [MP4] });
	try {
		const track = await input.getPrimaryAudioTrack(); assert.ok(track);
		const config = await track.getDecoderConfig(); assert.ok(config);
		assert.equal(config.codec, 'opus'); assert.equal(config.sampleRate, 48_000); assert.equal(config.numberOfChannels, 1);
		const description = config.description; assert.ok(description);
		const header = ArrayBuffer.isView(description)
			? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description);
		assert.deepEqual([...header], [79, 112, 117, 115, 72, 101, 97, 100, 1, 1, 56, 1, 128, 187, 0, 0, 0, 0, 0]);
		assert.equal(hasReviewedContainerOpusPreSkip(config), true, 'all three real files select the same positive-preSkip mapping-family0 path');
		assert.equal((await AdvertisedNativeDecoder.isConfigSupported(config)).supported, true);
	} finally { input.dispose(); }
	const expectedFrames = kind === 'origin' ? 9600 : kind === 'ordinary' ? 14_400 : 10_080;
	assert.equal(reference.length, expectedFrames);
	// The production streamed importer selects real reviewed Opus WASM.
	// Native support is advertised above; decoder selection still belongs to the
	// reviewed production path, and an unrelated whole-file fallback must fail.
	const codecRuntime = { ...createReviewedAudioCodecRuntime(), async decode() {
		assert.fail('Opus MP4 must use its streaming packet decoder, not a whole-file codec fallback');
	} };
	const { source, channels, contribution } = await importAndReopenAudio(context,
		new File([file], `${kind}.m4a`, { type: file.type }), { codecRuntime });
	assert.equal(nativeConstructions, 0, 'advertised native support cannot replace the preferred production decoder');
	assert.equal(source.sampleRate, 48_000); assert.equal(source.channelCount, 1); assert.equal(source.frameCount, expectedFrames);
	assert.deepEqual(contribution.warnings, []);
	const pcm = channels[0]; assert.ok(pcm); assert.equal(pcm.length, expectedFrames);
	let maximumError = 0, tailPeak = 0;
	for (let frame = 0; frame < expectedFrames; frame++) {
		maximumError = Math.max(maximumError, Math.abs(pcm[frame]! - reference[frame]!));
		if (kind === 'ordinary' && frame >= 6240 && frame < 8640) assert.equal(pcm[frame], 0);
		if (frame >= expectedFrames - 1920) tailPeak = Math.max(tailPeak, Math.abs(pcm[frame]!));
	}
	assert.ok(maximumError < 1e-7, `independent reference PCM error ${maximumError}`);
	assert.ok(tailPeak > .08, 'authored programme tail must survive timestamp placement');
});
