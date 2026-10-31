/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withDehazePixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-dehaze-v1.ts';
import { withDetailSharpenPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-sharpen-v1.ts';
import type { PixelFrameDescriptorV1, PixelFrameLimitsV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';

type Frame = Readonly<{ descriptor: Readonly<PixelFrameDescriptorV1>; pixels: Uint8Array<ArrayBuffer> }>;
const LIMITS: Readonly<PixelFrameLimitsV1> = Object.freeze({ maximumSidePixels: 16, maximumPixels: 256, maximumBytes: 1024 });
const DIMENSIONS = [[1, 1], [1, 7], [7, 1], [3, 3], [5, 4], [4, 5], [9, 7]] as const;
const ALPHAS = [0, 1, 2, 64, 127, 128, 200, 254, 255] as const;
const DEHAZE_AMOUNTS = [-100, -73.25, -0.25, -0.125, 0, 0.125, 0.25, 37.125, 73.25, 100] as const;
const SHARP_AMOUNTS = [0, 0.125, 12.375, 50, 100, 199.875, 200] as const;
const THRESHOLDS = [0, 1, 17, 127, 254, 255] as const;

function source(width: number, height: number, phase: number): Frame {
	// A padded, nonzero-offset view authenticates the real logical aperture.
	const backing = new Uint8Array(width * height * 4 + 20); backing.fill(173);
	const pixels = backing.subarray(8, 8 + width * height * 4);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const index = y * width + x, offset = 4 * index;
		pixels[offset] = (13 + 71 * x + 37 * y + phase * 19) % 256;
		pixels[offset + 1] = (241 + 23 * x + 89 * y + phase * 11) % 256;
		pixels[offset + 2] = (47 + 109 * x + 17 * y + phase * 31) % 256;
		pixels[offset + 3] = ALPHAS[(index + phase) % ALPHAS.length]!;
	}
	return { descriptor: { schemaVersion: 1, width, height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels };
}

function dehaze(amount: number, enabled = true) {
	return { id: 'oracle-dehaze', type: 'dehaze-v1', enabled, params: { amount } };
}
function sharpen(amount: number, threshold: number, enabled = true) {
	return { id: 'oracle-sharp', type: 'detail-sharpen-v1', enabled, params: { amount, threshold } };
}
function snapshot(frame: Frame): Uint8Array<ArrayBuffer> { return new Uint8Array(frame.pixels.buffer).slice(); }

async function render(frame: Frame, effect: unknown, kernel: typeof withDehazePixelFrameV1): Promise<Uint8Array<ArrayBuffer>> {
	const before = snapshot(frame), borrowed: Uint8Array<ArrayBuffer>[] = [];
	const result = await kernel({ frame, effect }, view => {
		assert.deepEqual(view.descriptor, frame.descriptor);
		borrowed.push(view.pixels); return view.pixels.slice();
	}, { limits: LIMITS });
	assert.equal(borrowed.length, 1);
	assert.ok(borrowed.every(plane => plane.every(byte => byte === 0)), 'borrowed output retires before settlement');
	assert.deepEqual(snapshot(frame), before, 'Original and padding remain immutable');
	return result;
}

// These references deliberately retain the historical nine-neighbor loops.
// They do not import prepared scalar helpers or share a rolling-column path.
function referenceDehaze(frame: Frame, amount: number, enabled = true): Uint8Array<ArrayBuffer> {
	const { width, height } = frame.descriptor, input = frame.pixels, output = input.slice();
	const gain = Math.round(amount * 256 / 100), fog = gain < 0 ? Math.floor((-gain * 128 + 128) / 256) : 0;
	if (!enabled || gain === 0) return output;
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const offset = 4 * (y * width + x); if (input[offset + 3] === 0) continue;
		let dark = 255;
		if (gain > 0) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
			const row = Math.max(0, Math.min(height - 1, y + dy)), column = Math.max(0, Math.min(width - 1, x + dx));
			const n = 4 * (row * width + column), alpha = input[n + 3]!;
			const effective = Math.floor((Math.min(input[n]!, input[n + 1]!, input[n + 2]!) * alpha + 255 * (255 - alpha) + 127) / 255);
			dark = Math.min(dark, effective);
		}
		const transmission = gain > 0 ? Math.max(26, 256 - Math.floor(dark * gain * 243 / 65280)) : 256;
		for (let channel = 0; channel < 3; channel++) {
			const value = input[offset + channel]!;
			output[offset + channel] = gain < 0 ? value + Math.floor(((255 - value) * fog + 128) / 256)
				: Math.max(0, Math.min(255, 255 + Math.floor((2 * (value - 255) * 256 + transmission) / (2 * transmission))));
		}
	}
	return output;
}

function referenceSharpen(frame: Frame, amount: number, threshold: number, enabled = true): Uint8Array<ArrayBuffer> {
	const { width, height } = frame.descriptor, input = frame.pixels, output = input.slice(), gain = Math.round(amount * 256 / 100);
	if (!enabled || gain === 0) return output;
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const offset = 4 * (y * width + x); if (input[offset + 3] === 0) continue;
		let weight = 0; const sums = [0, 0, 0];
		for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
			const row = Math.max(0, Math.min(height - 1, y + dy)), column = Math.max(0, Math.min(width - 1, x + dx));
			const n = 4 * (row * width + column), contribution = input[n + 3]! * (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
			weight += contribution;
			for (let channel = 0; channel < 3; channel++) sums[channel] = sums[channel]! + contribution * input[n + channel]!;
		}
		for (let channel = 0; channel < 3; channel++) {
			const value = input[offset + channel]!;
			if (weight === 0) continue;
			const blur = Math.floor((2 * sums[channel]! + weight) / (2 * weight)), delta = value - blur;
			if (Math.abs(delta) > threshold) output[offset + channel] = Math.max(0, Math.min(255, value + Math.floor((delta * gain + 128) / 256)));
		}
	}
	return output;
}

test('byte Dehaze preserves independent nine-neighbor goldens across replicated borders, alpha and signed quantization', async () => {
	for (const [width, height] of DIMENSIONS) for (const phase of [0, 4, 8]) {
		const frame = source(width, height, phase);
		for (const amount of DEHAZE_AMOUNTS) {
			assert.deepEqual(await render(frame, dehaze(amount), withDehazePixelFrameV1), referenceDehaze(frame, amount),
				`Dehaze ${width}x${height} phase=${phase} amount=${amount}`);
		}
		assert.deepEqual(await render(frame, dehaze(100, false), withDehazePixelFrameV1), frame.pixels);
	}
});

test('byte DetailSharpen preserves independent alpha-weighted binomial sums, thresholds and signed rounding', async () => {
	for (const [width, height] of DIMENSIONS) for (const phase of [0, 4, 8]) {
		const frame = source(width, height, phase);
		for (const amount of SHARP_AMOUNTS) for (const threshold of THRESHOLDS) {
			assert.deepEqual(await render(frame, sharpen(amount, threshold), withDetailSharpenPixelFrameV1), referenceSharpen(frame, amount, threshold),
				`Detail ${width}x${height} phase=${phase} amount=${amount} threshold=${threshold}`);
		}
		assert.deepEqual(await render(frame, sharpen(200, 0, false), withDetailSharpenPixelFrameV1), frame.pixels);
	}
});

test('ordered public Dehaze then DetailSharpen scopes match independent grids and retire both borrowed planes', async () => {
	for (const [width, height] of DIMENSIONS) for (const phase of [0, 4, 8]) {
		const frame = source(width, height, phase), before = snapshot(frame);
		for (const dehazeAmount of [-73.25, 0, 37.125]) for (const [amount, threshold] of [[12.375, 1], [50, 0], [200, 17]] as const) {
			const expectedDehaze = referenceDehaze(frame, dehazeAmount);
			const expected = referenceSharpen({ descriptor: frame.descriptor, pixels: expectedDehaze }, amount, threshold);
			const borrowed: Uint8Array<ArrayBuffer>[] = [];
			const result = await withDehazePixelFrameV1({ frame, effect: dehaze(dehazeAmount) }, dehazed => {
				borrowed.push(dehazed.pixels);
				assert.deepEqual(dehazed.pixels, expectedDehaze);
				return withDetailSharpenPixelFrameV1({ frame: dehazed, effect: sharpen(amount, threshold) }, sharpened => {
					borrowed.push(sharpened.pixels); assert.deepEqual(sharpened.descriptor, frame.descriptor);
					return sharpened.pixels.slice();
				}, { limits: LIMITS });
			}, { limits: LIMITS });
			assert.deepEqual(result, expected, `ordered ${width}x${height} phase=${phase} dehaze=${dehazeAmount} detail=${amount}/${threshold}`);
			assert.equal(borrowed.length, 2); assert.ok(borrowed.every(plane => plane.every(byte => byte === 0)));
			assert.deepEqual(snapshot(frame), before, 'both stages preserve complete Original backing');
		}
	}
});
