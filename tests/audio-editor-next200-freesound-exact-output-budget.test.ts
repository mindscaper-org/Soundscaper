/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareFreesoundUploadFile } from '../src/common/editor/ui/workspace/freesound-upload-file-preparation.ts';
import { encodeWav, inspectWavLayout } from '../src/common/editor/wav.js';

for (const [channelCount, frameCount] of [[1, 12], [2, 7], [3, 6]]) {
	test(`a ${channelCount}-channel converted WAV fitting the exact transfer budget remains uploadable`, async () => {
		// Scale the same production 100 MB boundary down to keep the regression small.
		const maximumBytes = 128;
		const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount).fill(0.25));
		const file = new File([Uint8Array.from(encodeWav(channels, { sampleRate: 48_000, bitDepth: 16 })).buffer], 'field.wave');
		const decoded = { length: frameCount, numberOfChannels: channelCount, sampleRate: 48_000,
			getChannelData: (index: number) => channels[index] } as unknown as AudioBuffer;
		const expected = inspectWavLayout({ totalFrames: frameCount, channelCount, sampleRate: 48_000, bitDepth: 24 }).byteLength;
		assert.ok(file.size < maximumBytes && expected <= maximumBytes);
		const output = await prepareFreesoundUploadFile(file, undefined, {
			maximumBytes,
			createDecodeContext: () => ({ decodeAudioData: async () => decoded, close: async () => undefined }),
		});
		assert.equal(output.size, expected);
		assert.equal(output.name, 'field.wav');
		assert.equal(output.type, 'audio/wav');
		await assert.rejects(prepareFreesoundUploadFile(file, undefined, {
			maximumBytes: expected - 1,
			createDecodeContext: () => ({ decodeAudioData: async () => decoded, close: async () => undefined }),
		}), /100 MB/u, 'the exact limit still refuses an output one byte too large');
	});
}
