/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { encodeDedicatedAudioPcm } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';

test('the reviewed Opus import decoder discards codec pre-skip and retains the complete audible ending', async () => {
	const sampleRate = 48_000;
	const audio = Float32Array.from({ length: sampleRate }, (_, index) => Math.sin(index / 30) / 4);
	const encoded = await encodeDedicatedAudioPcm({ format: 'opus', input: new Uint8Array(audio.buffer), frameCount: audio.length,
		channelCount: 1, sampleRate, settings: { bitrateKbps: 96, vbrMode: 1 }, maximumOutputBytes: 1024 ** 2 },
	{ loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
	const previousFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => input instanceof URL && input.protocol === 'file:'
		? new Response(Uint8Array.from(await readFile(input))) : previousFetch(input, init);
	try {
		const prepared = await prepareStreamedAudioImport(new File([Uint8Array.from(encoded)], 'Recording.opus', { type: 'audio/ogg' }));
		try {
			assert.equal(prepared.descriptor.frameCount, audio.length);
			const chunks: Float32Array[] = [];
			await prepared.stream({ chunkFrames: 1024, onChunk(channels) { chunks.push(channels[0]!); } });
			const output = Float32Array.from(chunks.flatMap(chunk => [...chunk]));
			assert.equal(output.length, audio.length);
			let squaredError = 0;
			for (let index = 1000; index < audio.length; index++) squaredError += (output[index]! - audio[index]!) ** 2;
			assert.ok(squaredError / (audio.length - 1000) < 0.001, 'Codec lookahead cannot shift the imported programme.');
			const ending = output.slice(-200);
			assert.ok(ending.reduce((sum, value, index) => sum + (value - audio[audio.length - 200 + index]!) ** 2, 0) / ending.length < 0.001,
				'The final audible samples must survive the gapless trim.');
		} finally { prepared.dispose(); }
	} finally { globalThis.fetch = previousFetch; }
});
