/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoFrameCaptureTimingMatcher } from '../src/common/editor/video-frame-capture-timing.ts';

const file = new Blob(['native video']);
const readTiming = () => Promise.resolve({
	timescale: 1_000, presentationTicks: [0n, 67n, 140n], finalFrameDurationTicks: 40n,
});

test('capture matches frame PTS and interior times across variable source intervals', async () => {
	const matches = await createVideoFrameCaptureTimingMatcher(file, { readTiming });
	assert.equal(matches(.0335, 0), true);
	assert.equal(matches(.0335, .0335), true);
	assert.equal(matches(.0335, .067), false);
	assert.equal(matches(.1005, 0), false);
	assert.equal(matches(.1005, .067), true);
	assert.equal(matches(.1005, .140), false);
	assert.equal(matches(.160, .140), true);
	assert.equal(matches(.160, .180), false);
	assert.equal(matches(.067, .066999999), true);
	assert.equal(matches(NaN, 0), false);
	assert.equal(matches(.0335, NaN), false);
});

test('unknown containers retain exact-time matching and cancellation is never swallowed', async () => {
	const matches = await createVideoFrameCaptureTimingMatcher(file, {
		readTiming: () => Promise.reject(new Error('Unsupported timing.')),
	});
	assert.equal(matches(.1, .1), true);
	assert.equal(matches(.1, 0), false);
	const controller = new AbortController();
	await assert.rejects(createVideoFrameCaptureTimingMatcher(file, { signal: controller.signal,
		readTiming: () => { controller.abort(); return Promise.reject(controller.signal.reason); },
	}), { name: 'AbortError' });
});
