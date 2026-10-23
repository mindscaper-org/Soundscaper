/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { inspectDecodedAudioSampleRate, inspectEncodedAudioSampleRate } from '../src/common/editor/audio-file-metadata.js';
import { isStreamedAudioImportFile } from '../src/common/editor/streamed-audio-import-file.ts';
import { ordinaryWebmOpusFixture, surroundWebmOpusFixture } from './helpers/ordinary-ogg-opus-fixture.ts';

for (const extension of ['webm', 'mka'] as const) test(`audio-only ${extension} keeps its authored native decode clock and retains the bounded decoder control`, async () => {
	const original = await ordinaryWebmOpusFixture(extension);
	class BoundedFile extends File {
		override async arrayBuffer(): Promise<ArrayBuffer> { throw new Error('A whole recording must not be read into memory.'); }
		override stream(): ReadableStream<Uint8Array<ArrayBuffer>> { throw new Error('Import must use bounded slices.'); }
	}
	const file = new BoundedFile([original], original.name, { type: original.type });
	assert.equal(isStreamedAudioImportFile(file), false);
	const encoded = await original.arrayBuffer();
	assert.equal(inspectEncodedAudioSampleRate(encoded), 48_000);
	assert.equal(inspectDecodedAudioSampleRate(encoded), 48_000);
	assert.equal(isStreamedAudioImportFile(new File([original], 'Recording', { type: original.type })), false);
	assert.equal(isStreamedAudioImportFile(new File([original], original.name)), false);
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

test('native surround Opus retains its decoded clock without opting into a stereo-only fallback', async () => {
	const file = surroundWebmOpusFixture();
	assert.equal(isStreamedAudioImportFile(file), false);
	assert.equal(inspectDecodedAudioSampleRate(await file.arrayBuffer()), 48_000);
	assert.equal(inspectEncodedAudioSampleRate(await file.arrayBuffer()), 48_000);
});

for (const finiteSegment of [false, true]) test(`bounded Opus header probing retains codec/enable scope; finite=${finiteSegment}`, () => {
	const field = (id: readonly number[], body: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => Uint8Array.of(...id, 128 | body.length, ...body);
	const audio = (codec: string, enabled = true): Uint8Array<ArrayBuffer> => field([0xae], Uint8Array.of(
		...field([0x83], Uint8Array.of(2)), ...field([0xb9], Uint8Array.of(enabled ? 1 : 0)),
		...field([0x86], new TextEncoder().encode(codec))));
	const file = (...entries: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> => {
		const tracks = field([0x16, 0x54, 0xae, 0x6b], Uint8Array.from(entries.flatMap(entry => [...entry])));
		return Uint8Array.of(...field([0x1a, 0x45, 0xdf, 0xa3], new Uint8Array()), 0x18, 0x53, 0x80, 0x67,
			finiteSegment ? 128 | tracks.length : 255, ...tracks);
	};
	assert.equal(inspectDecodedAudioSampleRate(file(audio('A_OPUS'))), 48_000);
	assert.equal(inspectDecodedAudioSampleRate(file(audio('A_OPUS'), audio('A_AAC', false))), 48_000);
	assert.equal(inspectDecodedAudioSampleRate(file(audio('A_OPUS'), audio('A_AAC'))), null);
	assert.equal(inspectDecodedAudioSampleRate(file(audio('A_AAC'))), null);
	assert.equal(inspectDecodedAudioSampleRate(file(audio('A_OPUS', false))), null);
	const valid = file(audio('A_OPUS'));
	assert.equal(inspectDecodedAudioSampleRate(valid.subarray(0, valid.length - 1)), null);
});
