/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importAndReopenAudio } from './helpers/audio-import-archive-custody.ts';
import { createReviewedAudioCodecRuntime } from './helpers/reviewed-audio-codec-runtime.ts';
import { libsndfileRifxSamples, libsndfileRifxTone, libsndfileRiffSamples } from './helpers/libsndfile-rifx-fixture.ts';

for (const format of ['s16', 's24', 'f32', 'f64'] as const) test(`RIFX ${format} byte order survives actual controller, store and portable Scape reopening`, async context => {
	const file = new File([libsndfileRifxSamples(format)], 'big-endian.wav', { type: 'audio/wav' });
	const result = await importAndReopenAudio(context, file, { codecRuntime: createReviewedAudioCodecRuntime() });
	assert.deepEqual([result.source.sampleRate, result.source.channelCount, result.source.frameCount], [48_000, 1, 4]);
	const values = result.channels[0]; assert.ok(values); assert.equal(values.length, 4);
	for (const [frame, expected] of [.25, -.5, .75, -1].entries()) assert.ok(Math.abs(values[frame]! - expected) <= 1 / 32768);
});

test('RIFF control byte order survives actual controller, store and portable Scape reopening', async context => {
	const result = await importAndReopenAudio(context, new File([libsndfileRiffSamples()], 'little-endian.wav', { type: 'audio/wav' }),
		{ codecRuntime: createReviewedAudioCodecRuntime() });
	assert.deepEqual([result.source.sampleRate, result.source.channelCount, result.source.frameCount], [48_000, 1, 4]);
	assert.deepEqual(Array.from(result.channels[0]!), [.25, -.5, .75, -1]);
});

test('frozen libsndfile RIFX tone retains every independent programme sample through real archives', async context => {
	const result = await importAndReopenAudio(context, new File([libsndfileRifxTone()], 'Big-endian.wav', { type: 'audio/wav' }),
		{ codecRuntime: createReviewedAudioCodecRuntime() });
	assert.deepEqual([result.source.sampleRate, result.source.channelCount, result.source.frameCount], [48_000, 1, 48_000]);
	const channel = result.channels[0]; assert.ok(channel); assert.equal(channel.length, 48_000);
	for (const [frame, sample] of channel.entries()) {
		assert.ok(Math.abs(sample - .25 * Math.sin(2 * Math.PI * 400 * frame / 48_000)) <= 1 / 32768, `independent authored tone at frame${frame}`);
	}
});

test('frozen libsndfile float AIFF-C retains every independent programme sample through real archives', async context => {
	const encoded = await readFile(new URL('./fixtures/libsndfile-float32.aifc.base64', import.meta.url), 'ascii');
	const file = new File([Uint8Array.from(Buffer.from(encoded, 'base64'))], 'ordinary-float.aifc', { type: 'audio/aiff' });
	const result = await importAndReopenAudio(context, file, { codecRuntime: createReviewedAudioCodecRuntime() });
	assert.deepEqual([result.source.sampleRate, result.source.channelCount, result.source.frameCount], [48_000, 1, 4800]);
	const channel = result.channels[0]; assert.ok(channel); assert.equal(channel.length, 4800);
	for (const [frame, sample] of channel.entries()) {
		assert.ok(Math.abs(sample - .25 * Math.sin(2 * Math.PI * 440 * frame / 48_000)) < 1e-7, `independent authored float tone at frame${frame}`);
	}
});
