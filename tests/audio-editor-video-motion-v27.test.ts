/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	normalizeVideoMotionAnalysisReferenceV1,
	normalizeVideoProcessorStackV1,
	requireFreshVideoMotionAnalysisV1,
} from '../src/common/editor/video-motion-model-v27.ts';
import {
	applySimilarityTransformV1,
	createAdjacentLucasKanadeTrackerV1,
	createGrayVideoFrameV1,
	detectShiTomasiFeaturesV1,
	estimateSimilarityRansacV1,
	resolveStabilizationTransformV1,
	trackPyramidalLucasKanadeV1,
} from '../src/common/editor/video-motion-processing-v27.ts';
import { processTemporalDenoiseV1 } from '../src/common/editor/video-motion-denoise-v27.ts';
import { sampleGrayVideoFrameBilinearV1 } from '../src/common/editor/gray-video-frame-sampling-v1.ts';

const SHA_A = 'a1'.repeat(32);
const SHA_B = 'b2'.repeat(32);

function translatedDot(dx: number, dy: number): ReturnType<typeof createGrayVideoFrameV1> {
	const width = 16;
	const height = 16;
	const samples = Array.from({ length: width * height }, () => 0);
	for (let y = 5 + dy; y < 10 + dy; y += 1) {
		for (let x = 4 + dx; x < 9 + dx; x += 1) samples[y * width + x] = 1;
	}
	return createGrayVideoFrameV1({ width, height, samples });
}

test('gray-frame bilinear sampling clamps coordinates and interpolates edges', () => {
	const frame = createGrayVideoFrameV1({ width: 2, height: 2, samples: [0, 0.25, 0.75, 1] });
	assert.equal(sampleGrayVideoFrameBilinearV1(frame, 0.5, 0.5), 0.5);
	assert.equal(sampleGrayVideoFrameBilinearV1(frame, -2, 0.5), 0.375);
	assert.equal(sampleGrayVideoFrameBilinearV1(frame, 3, 0.5), 0.625);
});

test('processor stacks are closed, bounded, and keep optical flow out of retime', () => {
	const stack = normalizeVideoProcessorStackV1({
		schemaVersion: 1,
		id: 'stack-1',
		sourceId: 'video-1',
		processors: [
			{
				schemaVersion: 1,
				id: 'track-1',
				kind: 'tracking',
				enabled: true,
				maximumFeatures: 128,
				quality: 0.05,
				minimumDistance: 3,
				windowRadius: 3,
				pyramidLevels: 3,
			},
			{
				schemaVersion: 1,
				id: 'stabilize-1',
				kind: 'similarity-stabilization',
				enabled: true,
				motionProvider: 'pyramidal-lucas-kanade',
				analysisId: 'analysis-1',
				strength: 1,
			},
			{
				schemaVersion: 1,
				id: 'denoise-1',
				kind: 'temporal-denoise',
				enabled: true,
				motionProvider: 'pyramidal-lucas-kanade',
				analysisId: 'analysis-1',
				radius: 1,
				strength: 0.5,
			},
		],
	});
	assert.equal(stack.processors.length, 3);
	assert.equal(Object.isFrozen(stack.processors), true);
	assert.throws(() => normalizeVideoProcessorStackV1({
		...stack,
		processors: [{
			schemaVersion: 1,
			id: 'retime-1',
			kind: 'retime-interpolation',
			enabled: true,
			motionProvider: 'pyramidal-lucas-kanade',
		}],
	}), /processor|unsupported|retime/iu);
});

test('motion analysis references are digest-bound and stale inputs refuse export', () => {
	const analysis = normalizeVideoMotionAnalysisReferenceV1({
		schemaVersion: 1,
		id: 'analysis-1',
		sourceId: 'video-1',
		processorStackId: 'stack-1',
		inputSha256: SHA_A,
		settingsSha256: SHA_B,
		storageKey: `motion-sha256:${SHA_B}`,
		sha256: SHA_B,
		byteLength: 4096,
		startFrame: 0,
		endFrame: 240,
	});
	assert.equal(requireFreshVideoMotionAnalysisV1(analysis, {
		sourceId: 'video-1',
		processorStackId: 'stack-1',
		inputSha256: SHA_A,
		settingsSha256: SHA_B,
	}).id, 'analysis-1');
	assert.throws(() => requireFreshVideoMotionAnalysisV1(analysis, {
		sourceId: 'video-1',
		processorStackId: 'stack-1',
		inputSha256: SHA_B,
		settingsSha256: SHA_B,
	}), /stale|input digest/iu);
});

test('gray frame admission reuses owned immutable frames and snapshots external samples', () => {
	const input = { width: 2, height: 1, samples: [-0, 0.5] };
	const admitted = createGrayVideoFrameV1(input);
	assert.equal(createGrayVideoFrameV1(admitted), admitted);
	input.samples[1] = 1;
	assert.deepEqual(admitted.samples, [0, 0.5]);
	assert.throws(() => createGrayVideoFrameV1(Object.freeze({
		width: 2, height: 1, samples: Object.freeze([0, NaN]),
	})), /gray frame sample 1/iu);
});

test('Shi-Tomasi features and pyramidal Lucas-Kanade tracks are deterministic', () => {
	const before = translatedDot(0, 0);
	const after = translatedDot(1, 1);
	const first = detectShiTomasiFeaturesV1(before, {
		maximumFeatures: 8,
		quality: 0.01,
		minimumDistance: 2,
	});
	const second = detectShiTomasiFeaturesV1(before, {
		maximumFeatures: 8,
		quality: 0.01,
		minimumDistance: 2,
	});
	assert.deepEqual(first, second);
	assert.ok(first.length >= 2);

	const tracked = trackPyramidalLucasKanadeV1(before, after, first, {
		windowRadius: 2,
		pyramidLevels: 3,
		maximumIterations: 12,
		epsilon: 1e-4,
	});
	const accepted = tracked.filter((item) => item.status === 'tracked');
	assert.ok(accepted.length >= 2);
	for (const item of accepted) {
		assert.ok(Math.abs((item.target.x - item.source.x) - 1) < 0.25);
		assert.ok(Math.abs((item.target.y - item.source.y) - 1) < 0.25);
	}
});

test('overlapping Shi–Tomasi windows retain their exact floating-point scores and ordering', () => {
	const width = 35, height = 15;
	const samples = Array.from({ length: width * height }, (_, i) => ((i * 73) ^ ((i % width + 1) * i)) % 251 / 251);
	const frame = createGrayVideoFrameV1({ width, height, samples });
	const features = detectShiTomasiFeaturesV1(frame, { maximumFeatures: 50, quality: 0.0001, minimumDistance: 1.5 });
	assert.equal(createHash('sha256').update(JSON.stringify(features)).digest('hex'),
		'3ae78400ee740ba6b0440afff43e393ab120f2caadfadf1423040b30aef18965');
});

test('tracking adjacent pairs keeps the same output when reusing the middle pyramid', () => {
	const frames = [translatedDot(0, 0), translatedDot(1, 1), translatedDot(2, 2)] as const;
	const track = createAdjacentLucasKanadeTrackerV1();
	const options = { windowRadius: 2, pyramidLevels: 3, maximumIterations: 12, epsilon: 1e-4 };
	for (const [left, right, pyramidLevels] of [[0, 1, 3], [1, 2, 3], [2, 1, 2]] as const) {
		const previous = frames[left];
		const next = frames[right];
		const features = detectShiTomasiFeaturesV1(previous, { maximumFeatures: 8, quality: 0.01, minimumDistance: 2 });
		const pairOptions = { ...options, pyramidLevels };
		assert.deepEqual(track(previous, next, features, pairOptions),
			trackPyramidalLucasKanadeV1(previous, next, features, pairOptions));
	}
});

test('iterated tracking retains its subpixel tracks, errors and lost border features', () => {
	const width = 40, height = 32;
	const frameAt = (dx: number, dy: number) => createGrayVideoFrameV1({
		width, height, samples: Array.from({ length: width * height }, (_, i) => {
			const x = i % width - dx, y = Math.floor(i / width) - dy;
			return ((x * 73 ^ y * 63) & 255) / 255;
		}),
	});
	const tracks = trackPyramidalLucasKanadeV1(frameAt(0, 0), frameAt(1, 1), [
		{ x: 12.25, y: 11.125, score: 0.1 }, { x: 24, y: 18.5, score: 0.2 }, { x: 3, y: 3, score: 0.3 },
	], { windowRadius: 3, pyramidLevels: 3, maximumIterations: 24, epsilon: 1e-4 });
	assert.equal(createHash('sha256').update(JSON.stringify(tracks)).digest('hex'),
		'99364b64643386ab60be163b720e8f86fa97601a76b8d6912095071c210ab427');
});

test('deterministic RANSAC recovers a similarity transform and ignores an outlier', () => {
	const transform = estimateSimilarityRansacV1([
		{ source: { x: 0, y: 0 }, target: { x: 4, y: -2 }, confidence: 1 },
		{ source: { x: 2, y: 0 }, target: { x: 4, y: 0 }, confidence: 1 },
		{ source: { x: 0, y: 2 }, target: { x: 2, y: -2 }, confidence: 1 },
		{ source: { x: 2, y: 2 }, target: { x: 2, y: 0 }, confidence: 1 },
		{ source: { x: 8, y: 8 }, target: { x: -50, y: 42 }, confidence: 0.1 },
	], { inlierThreshold: 0.01, minimumInliers: 4 });
	assert.equal(transform.inlierCount, 4);
	assert.ok(Math.abs(transform.scale - 1) < 1e-9);
	assert.ok(Math.abs(transform.rotationRadians - Math.PI / 2) < 1e-9);
	const mapped = applySimilarityTransformV1({ x: 2, y: 2 }, transform);
	assert.ok(Math.abs(mapped.x - 2) < 1e-9);
	assert.ok(Math.abs(mapped.y) < 1e-9);

	const stabilization = resolveStabilizationTransformV1(transform, 1);
	const stable = applySimilarityTransformV1(mapped, stabilization);
	assert.ok(Math.abs(stable.x - 2) < 1e-9);
	assert.ok(Math.abs(stable.y - 2) < 1e-9);
});

test('deterministic RANSAC keeps its maximum match set bounded while rejecting outliers', () => {
	const matches = Array.from({ length: 512 }, (_, index) => {
		const source = { x: index % 32, y: Math.floor(index / 32) };
		return {
			source,
			target: index % 17 === 0
				? { x: source.x + 100, y: source.y - 100 }
				: { x: source.x + 3, y: source.y - 2 },
			confidence: index % 17 === 0 ? 0.1 : 1,
		};
	});
	const transform = estimateSimilarityRansacV1(matches, {
		inlierThreshold: 0.01, minimumInliers: 400,
	});
	assert.equal(transform.inlierCount, 481);
	assert.ok(Math.abs(transform.translateX - 3) < 1e-9);
	assert.ok(Math.abs(transform.translateY + 2) < 1e-9);
});

test('temporal denoise admits GPU-first output and computes CPU only after accelerator failure', async () => {
	const current = createGrayVideoFrameV1({ width: 2, height: 2, samples: [1, 1, 1, 1] });
	const neighbor = createGrayVideoFrameV1({ width: 2, height: 2, samples: [0, 0, 0, 0] });
	const neighbors = [{ frame: neighbor, transformToCurrent: {
		scale: 1, rotationRadians: 0, translateX: 0, translateY: 0,
		inlierCount: 4, meanError: 0,
	} }];
	const cpu = await processTemporalDenoiseV1({
		current, neighbors, strength: 0.5,
	});
	assert.deepEqual(cpu.samples, [0.75, 0.75, 0.75, 0.75]);

	const accelerated = await processTemporalDenoiseV1({
		current, neighbors,
		strength: 0.5,
		accelerator: {
			kind: 'webgl2',
			async temporalDenoise() {
				return createGrayVideoFrameV1({ width: 2, height: 2, samples: [0.25, 0.25, 0.25, 0.25] });
			},
		},
	});
	assert.deepEqual(accelerated.samples, [0.25, 0.25, 0.25, 0.25]);

	let fallbackReason = '';
	const fallback = await processTemporalDenoiseV1({
		current, neighbors,
		strength: 0.5,
		accelerator: {
			kind: 'webgl2',
			async temporalDenoise() {
				throw new Error('context lost');
			},
		},
		onAcceleratorFallback(reason) { fallbackReason = reason; },
	});
	assert.deepEqual(fallback, cpu);
	assert.match(fallbackReason, /WebGL2.*unavailable.*CPU fallback.*context lost/iu);

	const invalidGeometry = await processTemporalDenoiseV1({
		current, neighbors, strength: 0.5,
		accelerator: {
			kind: 'webgl2',
			async temporalDenoise() {
				return createGrayVideoFrameV1({ width: 1, height: 1, samples: [0.75] });
			},
		},
	});
	assert.deepEqual(invalidGeometry, cpu);
});

test('CPU temporal denoise prepares affine coefficients once and preserves the scalar result', async () => {
	const current = translatedDot(0, 0);
	const neighbor = translatedDot(1, -1);
	const transformToCurrent = {
		scale: 0.93, rotationRadians: 0.095, translateX: -1.2, translateY: 0.6,
		inlierCount: 12, meanError: 0.01,
	};
	const inverse = resolveStabilizationTransformV1(transformToCurrent, 1);
	const expected = current.samples.map((original, index) => {
		const x = index % current.width;
		const y = Math.floor(index / current.width);
		const coordinate = applySimilarityTransformV1({ x, y }, inverse);
		if (coordinate.x < 0 || coordinate.x > neighbor.width - 1
			|| coordinate.y < 0 || coordinate.y > neighbor.height - 1) return original;
		const total = original + sampleGrayVideoFrameBilinearV1(neighbor, coordinate.x, coordinate.y);
		return original + (total / 2 - original) * 0.5;
	});
	const originalLog = Math.log;
	const originalSin = Math.sin;
	let inverseResolutions = 0;
	let sines = 0;
	Math.log = (value: number): number => {
		inverseResolutions += 1;
		return originalLog(value);
	};
	Math.sin = (value: number): number => {
		sines += 1;
		return originalSin(value);
	};
	try {
		const output = await processTemporalDenoiseV1({
			current, neighbors: [{ frame: neighbor, transformToCurrent }], strength: 0.5,
		});
		assert.deepEqual(output.samples, expected);
	} finally {
		Math.log = originalLog;
		Math.sin = originalSin;
	}
	assert.equal(inverseResolutions, 2,
		'one validation and one CPU transform resolution are independent of pixel count');
	assert.equal(sines, 3, 'sine evaluation depends on neighbors and stays independent of pixel count');
});

test('motion processing observes cancellation', async () => {
	const controller = new AbortController();
	controller.abort(new Error('cancel motion'));
	await assert.rejects(() => processTemporalDenoiseV1({
		current: translatedDot(0, 0),
		neighbors: [],
		strength: 0.5,
		signal: controller.signal,
	}), /cancel motion|abort/iu);

	const active = new AbortController();
	let fallbackObserved = false;
	await assert.rejects(() => processTemporalDenoiseV1({
		current: translatedDot(0, 0), neighbors: [], strength: 0.5, signal: active.signal,
		accelerator: {
			kind: 'webgl2',
			async temporalDenoise(request) {
				active.abort(new Error('cancel accelerated motion'));
				return request.current;
			},
		},
		onAcceleratorFallback() { fallbackObserved = true; },
	}), /cancel accelerated motion/iu);
	assert.equal(fallbackObserved, false);
});
