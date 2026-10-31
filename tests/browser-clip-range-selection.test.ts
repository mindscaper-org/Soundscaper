/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { clipRangeRevealScrollLeft } from './browser/helpers/clip-range-selection.ts';

test('range selection reveals a drag start hidden behind the sticky track header', () => {
	const scrollLeft = clipRangeRevealScrollLeft({ startX: 218, endX: 346,
		left: 334, right: 1070, scrollLeft: 300, scale: 1 });
	assert.equal(scrollLeft, 180);
	assert.equal(218 + 300 - scrollLeft, 338);
});

test('range selection reveals a later clip without changing an already exposed range', () => {
	assert.equal(clipRangeRevealScrollLeft({ startX: 1160, endX: 1250,
		left: 334, right: 1070, scrollLeft: 0, scale: 1 }), 184);
	assert.equal(clipRangeRevealScrollLeft({ startX: 360, endX: 500,
		left: 334, right: 1070, scrollLeft: 120, scale: 1 }), 120);
});

test('range selection accounts for scaled timeline scroll coordinates', () => {
	assert.equal(clipRangeRevealScrollLeft({ startX: 218, endX: 346,
		left: 334, right: 1070, scrollLeft: 300, scale: 4 }), 270);
});
