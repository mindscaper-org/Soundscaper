/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';

import { planSpectralBrushGesture } from '../src/common/editor/ui/timeline/spectral-brush-model.ts';

const geometry = Object.freeze({
	laneWidth: 480,
	laneHeight: 200,
	contentOffsetX: CLIP_CONTENT_OFFSET,
	overscanStartFrame: 48_000,
	pixelsPerSecond: 120,
	sampleRate: 48_000,
	minimumFrequency: 0,
	maximumFrequency: 24_000,
	scale: 'linear' as const,
});

test('spectral brush gesture maps one pointer origin and drag radius into exact selection authority', () => {
	assert.deepEqual(planSpectralBrushGesture({
		...geometry,
		startX: 120,
		startY: 100,
		endX: 150,
		endY: 80,
	}), {
		// 120px into the lane is 108px into its audio: the lane draws its clips
		// CLIP_CONTENT_OFFSET pixels in, as the ruler and the playhead do.
		centerFrame: 91_200,
		centerFrequency: 12_000,
		radiusFrames: 12_000,
		radiusFrequency: 2_400,
	});
});

test('a stroke inside the content inset stays at the time the lane starts', () => {
	const edge = planSpectralBrushGesture({
		...geometry,
		startX: CLIP_CONTENT_OFFSET - 4,
		startY: 100,
		endX: CLIP_CONTENT_OFFSET - 4,
		endY: 100,
	});

	assert.equal(edge.centerFrame, 48_000);
});

test('spectral brush clicks at the lane edge retain a usable minimum radius', () => {
	assert.deepEqual(planSpectralBrushGesture({
		...geometry,
		startX: 0,
		startY: 200,
		endX: 0,
		endY: 200,
	}), {
		centerFrame: 48_000,
		centerFrequency: 0,
		radiusFrames: 1_600,
		radiusFrequency: 480,
	});
});

