/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../src/common/editor/wav-import.js';
import { inspectAiffBlobPcm } from '../src/common/editor/aiff-pcm-chunk-reader.ts';
import { prepareFreesoundUploadFile } from '../src/common/editor/ui/workspace/freesound-upload-file-preparation.ts';

for (const kind of ['wave', 'aifc'] as const) {
	test(`Freesound converts a supported ${kind} file after the browser's native decoder refuses it`, async () => {
		const input = kind === 'wave'
			? encodeWav([Float32Array.of(0, 0.25, -0.5, 0.75)], { sampleRate: 48_000, bitDepth: 16 })
			: Buffer.from((await readFile(new URL('./fixtures/libsndfile-float32.aifc.base64', import.meta.url), 'utf8')).trim(), 'base64');
		const file = new File([Uint8Array.from(input).buffer], `field-take.${kind}`, { lastModified: 42 });
		const expected = kind === 'wave' ? await inspectWavBlobPcm(file) : await inspectAiffBlobPcm(file);
		let closed = false;
		const output = await prepareFreesoundUploadFile(file, undefined, {
			createDecodeContext: () => ({ decodeAudioData: async () => { throw new DOMException('Encoding is not supported.', 'EncodingError'); },
				close: async () => { closed = true; } }),
		});
		assert.equal(closed, true);
		assert.equal(output.name, 'field-take.wav');
		assert.equal(output.type, 'audio/wav');
		assert.equal(output.lastModified, 42);
		const descriptor = await inspectWavBlobPcm(output);
		assert.equal(descriptor.sampleRate, expected.sampleRate);
		assert.equal(descriptor.channelCount, expected.channelCount);
		assert.equal(descriptor.frameCount, expected.frameCount);
		assert.equal(descriptor.bitDepth, 24);
		let frames = 0;
		await streamWavBlobPcm(output, { descriptor, onChunk: (packet: readonly Float32Array[]) => {
			frames += packet[0]!.length;
			assert.ok(packet.every(channel => channel.every(Number.isFinite)));
		} });
		assert.equal(frames, expected.frameCount);
	});
}
