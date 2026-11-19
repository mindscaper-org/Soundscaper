/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { importAndReopenAudio } from './helpers/audio-import-archive-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { createReviewedAudioCodecRuntime, useLocalAudioCodecPayloads } from './helpers/reviewed-audio-codec-runtime.ts';
import { createMetadataBudgetWavPackFixture, createMultiValueWavPackFixture, createReferenceWavPackFixture } from './helpers/wavpack-import-fixture.ts';

const EXPECTED = [
	Float32Array.from({ length: 4800 }, (_, frame) => Math.sin(frame * .1) * .2),
	Float32Array.from({ length: 4800 }, (_, frame) => Math.cos(frame * .03) * .1),
];

for (const type of [2, 0] as const) test(`WavPack APE locator type=${type} survives real decoding, publication and Scape reopening`, async context => {
	useLocalAudioCodecPayloads(context, { wavpackWorkerTransport: true });
	const file = await createReferenceWavPackFixture(type);
	const { source, channels, contribution } = await importAndReopenAudio(context, file, { codecRuntime: createReviewedAudioCodecRuntime() });
	assert.deepEqual([source.sampleRate, source.frameCount, source.channelCount], [48_000, 4800, 2]);
	assertPcmChannelsEqual(channels, EXPECTED);
	assert.deepEqual(contribution.warnings, []); assert.deepEqual(contribution.attachments, []);
	assert.equal(contribution.metadata.normalized.title, 'Referenced performance');
	assert.equal(contribution.metadata.raw.RELATED, 'https://example.org/credits/Éva');
});

for (const mode of ['control', 'fields'] as const) test(`WavPack optional APE ${mode} budget retains independent exact PCM through controller and portable archive`, async context => {
	useLocalAudioCodecPayloads(context, { wavpackWorkerTransport: true });
	const { source, channels, contribution } = await importAndReopenAudio(context,
		await createMetadataBudgetWavPackFixture(mode), { codecRuntime: createReviewedAudioCodecRuntime() });
	assert.deepEqual([source.sampleRate, source.frameCount, source.channelCount], [48_000, 4800, 2]);
	assertPcmChannelsEqual(channels, EXPECTED);
	if (mode === 'control') assert.deepEqual(contribution.warnings, []);
	else assert.match(contribution.warnings.join('\n'), /APE.*(?:limit|trailer)/u);
});

test('WavPack multi-value APE credits retain all exact text and PCM through actual import and archive', async context => {
	useLocalAudioCodecPayloads(context, { wavpackWorkerTransport: true });
	const { source, channels, contribution } = await importAndReopenAudio(context,
		await createMultiValueWavPackFixture(), { codecRuntime: createReviewedAudioCodecRuntime() });
	assert.deepEqual([source.sampleRate, source.frameCount, source.channelCount], [48_000, 4800, 2]);
	assertPcmChannelsEqual(channels, EXPECTED); assert.deepEqual(contribution.warnings, []);
	assert.deepEqual(contribution.metadata.normalized, { title: 'Two credited performers', artist: 'Ada; Béla',
		comment: 'First note; Second note', trackNumber: 3, date: '2026-10-23' });
	assert.equal(contribution.metadata.raw.ARTIST, 'Ada\0Béla'); assert.equal(contribution.metadata.raw.CUSTOM, 'One\0Two');
});
