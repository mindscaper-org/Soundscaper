/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { disableReviewedAudioImportDecoders } from '../src/common/editor/browser-reviewed-streamed-audio-decoders.ts';
import { importAndReopenAudio } from './helpers/audio-import-archive-custody.ts';
import { gappedOpusMp4Fixture } from './helpers/gapped-opus-mp4-fixture.ts';
import { nativeOpusMp4Fixture } from './helpers/native-opus-mp4-fixture.ts';
import { createReviewedAudioCodecRuntime, useLocalAudioCodecPayloads } from './helpers/reviewed-audio-codec-runtime.ts';

for (const kind of ['origin', 'ordinary', 'subpacket'] as const) test(`real Opus MP4 ${kind} retains independent programme PCM through import and Scape`, async context => {
	useLocalAudioCodecPayloads(context);
	context.after(() => { disableReviewedAudioImportDecoders(); });
	const { file, reference } = kind === 'origin' ? nativeOpusMp4Fixture() : gappedOpusMp4Fixture(kind);
	const expectedFrames = kind === 'origin' ? 9600 : kind === 'ordinary' ? 14_400 : 10_080;
	assert.equal(reference.length, expectedFrames);
	// The production streamed importer selects real reviewed Opus WASM.
	// Native decode is unavailable; unsupported fallback must fail honestly.
	const codecRuntime = createReviewedAudioCodecRuntime();
	const { source, channels, contribution } = await importAndReopenAudio(context, file, { codecRuntime });
	assert.equal(source.sampleRate, 48_000); assert.equal(source.channelCount, 1); assert.equal(source.frameCount, expectedFrames);
	assert.deepEqual(contribution.warnings, []);
	const pcm = channels[0]; assert.ok(pcm); assert.equal(pcm.length, expectedFrames);
	let maximumError = 0, tailPeak = 0;
	for (let frame = 0; frame < expectedFrames; frame++) {
		maximumError = Math.max(maximumError, Math.abs(pcm[frame]! - reference[frame]!));
		if (kind === 'ordinary' && frame >= 6240 && frame < 8640) assert.equal(pcm[frame], 0);
		if (frame >= expectedFrames - 1920) tailPeak = Math.max(tailPeak, Math.abs(pcm[frame]!));
	}
	assert.ok(maximumError < 1e-7, `independent reference PCM error ${maximumError}`);
	assert.ok(tailPeak > .08, 'authored programme tail must survive timestamp placement');
});
