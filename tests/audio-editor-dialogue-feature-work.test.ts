/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { dialogueFeatures } from '../src/common/editor/dialogue-alignment-features.ts';
import { dialogueFixture } from './helpers/dialogue-alignment-fixture.ts';

test('dialogue feature extraction reuses fixed coefficients across every frame', (t) => {
	const clips = [8_000, 44_100, 48_000].map(rate => {
		const voice = dialogueFixture([.453, .607, .351, .5], rate);
		return voice.subarray(0, voice.length - 3);
	});
	dialogueFeatures([clips[0]!], 8_000);
	const cosine = t.mock.method(Math, 'cos');
	const digests = ([8_000, 44_100, 48_000] as const).map((rate, index) => {
		const features = dialogueFeatures([clips[index]!], rate);
		assert.equal(features.count, 192);
		return createHash('sha256').update(new Uint8Array(features.vectors.buffer)).update(features.active).digest('hex');
	});
	assert.deepEqual(digests, [
		'250a84142b58052578d095aeab4eaeef5583b9652f1c1fdf1ed3ff52b77c9a98',
		'0bb731658baacfe99085ae4b9f41531379fd7ce8b6e4ea3e38e8b3866fe53c8e',
		'29236686a3669d64a8bc3373ee34cffd2d65d3dff120999b40f7ed98b3606bbd',
	]);
	assert.ok(cosine.mock.callCount() <= 192 * 3 * 8, 'only the FFT stage roots need a cosine per frame');
});
