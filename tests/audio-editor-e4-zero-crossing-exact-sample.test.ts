/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { findNearestAudioZeroCrossing } from '../src/common/editor/zero-crossing.js';

for (const sign of [-1, 1]) {
	for (const channelCount of [1, 2]) test(`a ${channelCount}-channel sample after exact zero is not itself a crossing (${sign})`, () => {
		const channels = Array.from({ length: channelCount }, () => Float32Array.of(-.25 * sign, 0, .25 * sign, .5 * sign));
		assert.equal(findNearestAudioZeroCrossing(channels, 2), 1);
		assert.equal(findNearestAudioZeroCrossing(channels, 1), 1, 'an edge already on the exact zero stays there');
		assert.equal(findNearestAudioZeroCrossing(channels, 2, { maximumDistance: 0 }), 2,
			'a bounded search never moves outside its admitted window');
	});
}

test('actual sign changes and the quietest linked fallback retain their original ownership', () => {
	assert.equal(findNearestAudioZeroCrossing([Float32Array.of(-.25, .25, .5)], 1), 1);
	assert.equal(findNearestAudioZeroCrossing([Float32Array.of(.5, .25, .5)], 2), 1);
	assert.equal(findNearestAudioZeroCrossing([Float32Array.of(.5, .25, .5), Float32Array.of(.5, .75, .5)], 2), 2);
});
