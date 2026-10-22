/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyAudioGrooveTemplate,
	normalizeAudioGrooveTemplate,
} from '../src/common/editor/audio-groove-template.ts';

test('normalizes a bounded reusable groove and applies its cycle exactly', () => {
	const groove = normalizeAudioGrooveTemplate({
		offsets: [0, { num: 1, den: 3 }],
	});
	assert.deepEqual(groove, {
		offsets: [{ num: 0, den: 1 }, { num: 1, den: 3 }],
	});

	const grid = { origin: 0, interval: 1 } as const;
	assert.deepEqual(applyAudioGrooveTemplate(0, grid, groove), { num: 0, den: 1 });
	assert.deepEqual(applyAudioGrooveTemplate(1, grid, groove), { num: 4, den: 3 });
	assert.deepEqual(applyAudioGrooveTemplate(2, grid, groove), { num: 2, den: 1 });
	assert.deepEqual(applyAudioGrooveTemplate(3, grid, groove), { num: 10, den: 3 });
	assert.deepEqual(applyAudioGrooveTemplate(-1, grid, groove), { num: -2, den: 3 });
});

test('groove strength has exact zero, one, and monotonic intermediate semantics', () => {
	const groove = normalizeAudioGrooveTemplate({ offsets: [0, { num: 1, den: 3 }] });
	const grid = { origin: 0, interval: 1 } as const;
	assert.deepEqual(applyAudioGrooveTemplate(1, grid, groove, 0), { num: 1, den: 1 });
	assert.deepEqual(applyAudioGrooveTemplate(1, grid, groove, { num: 1, den: 2 }), { num: 7, den: 6 });
	assert.deepEqual(applyAudioGrooveTemplate(1, grid, groove, 1), { num: 4, den: 3 });
});

test('rejects position-inverting groove templates', () => {
	assert.throws(() => normalizeAudioGrooveTemplate({ offsets: [0, -2] }), /strictly increasing/iu);
	assert.throws(() => normalizeAudioGrooveTemplate({ offsets: [0, 2] }), /cycle boundary/iu);
});
