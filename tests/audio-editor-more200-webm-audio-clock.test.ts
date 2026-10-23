/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { isStreamedAudioImportFile } from '../src/common/editor/streamed-audio-import-file.ts';
import { ordinaryWebmOpusFixture } from './helpers/ordinary-ogg-opus-fixture.ts';

for (const extension of ['webm', 'mka'] as const) test(`audio-only ${extension} uses bounded decoding at its authored Opus sample rate`, async () => {
	const original = await ordinaryWebmOpusFixture(extension);
	class BoundedFile extends File {
		override async arrayBuffer(): Promise<ArrayBuffer> { throw new Error('A whole recording must not be read into memory.'); }
		override stream(): ReadableStream<Uint8Array<ArrayBuffer>> { throw new Error('Import must use bounded slices.'); }
	}
	const file = new BoundedFile([original], original.name, { type: original.type });
	assert.equal(isStreamedAudioImportFile(file), true);
	assert.equal(isStreamedAudioImportFile(new File([original], 'Recording', { type: original.type })), true);
	assert.equal(isStreamedAudioImportFile(new File([original], original.name)), true);
	const previousFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => input instanceof URL && input.protocol === 'file:'
		? new Response(Uint8Array.from(await readFile(input))) : previousFetch(input, init);
	try {
		const prepared = await prepareStreamedAudioImport(file);
		try {
			assert.equal(prepared.descriptor.sampleRate, 48_000);
			assert.equal(prepared.descriptor.channelCount, 1);
			assert.ok(prepared.descriptor.frameCount > 24_000);
			let frames = 0, peak = 0;
			await prepared.stream({ chunkFrames: 1024, onChunk(channels) {
				assert.equal(channels.length, 1);
				assert.ok(channels[0]!.length <= 1024);
				frames += channels[0]!.length;
				for (const value of channels[0]!) peak = Math.max(peak, Math.abs(value));
			} });
			assert.equal(frames, prepared.descriptor.frameCount);
			assert.ok(peak > .01, `The ordinary microphone tone must survive decoding; peak=${peak}.`);
		} finally { prepared.dispose(); }
	} finally { globalThis.fetch = previousFetch; }
});
