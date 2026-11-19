/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { macroPlanPeakBytes } from '../src/common/editor/controller/effects/internal/macro/macro-plan-memory.ts';

test('serial macro admission retains every output and the largest track scratch allocation', () => {
	const plan = { outputBytes: 10, peakBytes: 100, effects: [] };
	assert.equal(macroPlanPeakBytes([plan]), 100, 'single-track admission stays unchanged');
	assert.equal(macroPlanPeakBytes([plan, plan]), 120, 'both outputs coexist with one active track');
	const largeOutput = { ...plan, outputBytes: 30 };
	assert.equal(macroPlanPeakBytes([largeOutput, largeOutput]), 180, 'publication needs all PCM, native buffers and write scratch');
});

test('linked truncation keeps the simultaneous group charge while independent truncation remains serial', () => {
	for (const independent of [false, true]) {
		const plan = { outputBytes: 10, peakBytes: 100,
			effects: [{ type: 'audacity-truncate-silence', params: { independent } }] };
		assert.equal(macroPlanPeakBytes([plan, plan]), independent ? 120 : 200);
	}
});
