/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Input, BlobSource, MP4 } from 'mediabunny';
import { prepareFreesoundUploadFile } from '../src/common/editor/ui/workspace/freesound-upload-file-preparation.ts';
import { freesoundLongM4aFixture } from './helpers/freesound-long-m4a-fixture.ts';

test('an ordinary small ten-minute M4A refuses its known oversized WAV before native PCM allocation', async () => {
	const file = new File([freesoundLongM4aFixture().buffer], 'podcast.m4a', { type: 'audio/mp4' });
	const input = new Input({ source: new BlobSource(file), formats: [MP4] });
	try {
		const track = await input.getPrimaryAudioTrack(); assert.ok(track);
		assert.equal(await track.getSampleRate(), 48_000);
		assert.equal(await track.getNumberOfChannels(), 2);
		assert.equal(await track.computeDuration(), 600);
		assert.ok(file.size < 300_000);
	} finally { input.dispose(); }
	let decodes = 0, closes = 0;
	await assert.rejects(prepareFreesoundUploadFile(file, undefined, { createDecodeContext: () => ({
		sampleRate: 48_000,
		decodeAudioData: async () => {
			decodes++;
			return { length: 28_800_000, sampleRate: 48_000, numberOfChannels: 2,
				getChannelData: () => assert.fail('An oversized PCM buffer must never be copied.') } as unknown as AudioBuffer;
		},
		close: async () => { closes++; },
	}) }), /100 MB/u);
	assert.equal(decodes, 0, 'the known 172.8 MB WAV must not first allocate 230.4 MB native PCM');
	assert.equal(closes, 1);
});
