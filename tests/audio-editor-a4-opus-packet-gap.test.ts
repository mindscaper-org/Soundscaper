/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { reviewedOpusPresentationTimestamp } from '../src/common/editor/browser-reviewed-streamed-audio-decoders.ts';
import { gappedOpusMp4Fixture } from './helpers/gapped-opus-mp4-fixture.ts';

for (const kind of ['ordinary', 'subpacket'] as const) test(`${kind} Opus MP4 packet gaps retain silence and later audio through canonical import`, async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async input => { assert.ok(input instanceof URL && input.protocol === 'file:'); return new Response(await readFile(input)); };
	try {
		const { file, reference } = gappedOpusMp4Fixture(kind); const prepared = await prepareStreamedAudioImport(file);
		assert.equal(prepared.descriptor.frameCount, reference.length); assert.equal(prepared.descriptor.sampleRate, 48000);
		const samples: number[] = []; await prepared.stream({ chunkFrames: 2048, onChunk(channels) { assert.ok(channels[0]!.length <= 2048); samples.push(...channels[0]!); } });
		assert.equal(samples.length, reference.length); let maximumError = 0;
		for (let frame = 0; frame < samples.length; frame++) maximumError = Math.max(maximumError, Math.abs(samples[frame]! - reference[frame]!));
		assert.ok(maximumError < 1e-7, `Every-sample programme timing/PCM error: ${maximumError}`);
		if (kind === 'ordinary') assert.ok(samples.slice(6240, 8640).every(value => value === 0), 'Authored gap remains silent.');
		assert.ok(samples.slice(-1920).some(value => Math.abs(value) > .08), 'Audio after the gap remains present.');
	} finally { globalThis.fetch = originalFetch; }
});


test('Opus packet clock synchronization is constant-sized through a long gap and tolerates one-frame quantization', () => {
	assert.deepEqual(reviewedOpusPresentationTimestamp(-.0065, null, 48000), { timestamp: -.0065, synchronize: false });
	assert.deepEqual(reviewedOpusPresentationTimestamp(.02001, .02, 48000), { timestamp: .02, synchronize: false });
	assert.deepEqual(reviewedOpusPresentationTimestamp(3600, .02, 48000), { timestamp: 3600, synchronize: true });
});

test('Opus packet overlap and unsafe source clocks refuse before source publication', () => {
	assert.throws(() => reviewedOpusPresentationTimestamp(.015, .02, 48000), /overlap/u);
	for (const timestamp of [NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => reviewedOpusPresentationTimestamp(timestamp, 0, 48000), /safe source clock/u);
	assert.throws(() => reviewedOpusPresentationTimestamp(0, 0, 0), /safe source clock/u);
});
