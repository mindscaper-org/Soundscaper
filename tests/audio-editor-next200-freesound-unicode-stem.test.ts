/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareFreesoundUploadFile } from '../src/common/editor/ui/workspace/freesound-upload-file-preparation.ts';
import { encodeWav } from '../src/common/editor/wav.js';

test('conversion retains a legal Unicode source basename across the old UTF16 cutoff', async () => {
	const stem = `${'a'.repeat(219)}🎙`;
	const name = `${stem}.wave`;
	assert.ok(new TextEncoder().encode(name).byteLength < 255, 'this is a normal on-disk filename');
	const pcm = Float32Array.of(.25, -.25);
	const file = new File([Uint8Array.from(encodeWav([pcm], { sampleRate: 48_000 })).buffer], name);
	const result = await prepareFreesoundUploadFile(file, undefined, { createDecodeContext: () => ({
		decodeAudioData: async () => ({ length: 2, sampleRate: 48_000, numberOfChannels: 1,
			getChannelData: () => pcm }) as unknown as AudioBuffer,
		close: async () => undefined,
	}) });
	assert.equal(result.name, `${stem}.wav`);
	assert.equal(result.name.includes('�'), false);
	assert.ok(new TextEncoder().encode(result.name).byteLength <= 255);
});
