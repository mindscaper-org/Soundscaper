/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { nativeOpusMp4Fixture } from './helpers/native-opus-mp4-fixture.ts';

test('ordinary Opus MP4 edit timing removes priming once before canonical source publication', async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async input => { assert.ok(input instanceof URL && input.protocol === 'file:'); return new Response(await readFile(input)); };
	try {
		const { file, reference } = nativeOpusMp4Fixture(); const prepared = await prepareStreamedAudioImport(file);
		assert.equal(prepared.descriptor.frameCount, 9600); assert.equal(prepared.descriptor.sampleRate, 48000);
		const samples: number[] = []; await prepared.stream({ chunkFrames: 2048, onChunk(channels) { samples.push(...channels[0]!); } });
		assert.equal(samples.length, reference.length); let maximumError = 0;
		for (let frame = 0; frame < samples.length; frame++) maximumError = Math.max(maximumError, Math.abs(samples[frame]! - reference[frame]!));
		assert.ok(maximumError < 1e-7, `Unshifted every-sample PCM error: ${maximumError}`);
	} finally { globalThis.fetch = originalFetch; }
});
