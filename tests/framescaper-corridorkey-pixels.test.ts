/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	decodeCorridorKeyPixelsV1,
	prepareCorridorKeyPixelsV1,
} from '../src/common/editor/assistance/corridorkey-pixels-v1.ts';

const PADDED_PIXELS = 256 * 256;
const ENCODED_WHITE = 0.6657154364225782;
const ENCODED_MID_GREY = 0.4809087659619313;
const ENCODED_DARK_GREY = 0.3082731722161519;

function raster(width: number, height: number, pixels: readonly (readonly number[])[]) {
	assert.equal(pixels.length, width * height);
	return { width, height, rgba: Uint8Array.from(pixels.flat()) };
}

function output(width = 3, height = 1) {
	const paddedWidth = Math.ceil(width / 256) * 256;
	const paddedHeight = Math.ceil(height / 256) * 256;
	const pixels = paddedWidth * paddedHeight;
	const foreground = new Float32Array(pixels * 3);
	foreground.fill(ENCODED_WHITE, 0, pixels);
	foreground.fill(ENCODED_MID_GREY, pixels, pixels * 2);
	foreground.fill(ENCODED_DARK_GREY, pixels * 2);
	return { width, height, alpha: new Float32Array(pixels).fill(1), foreground };
}

function approximately(actual: number, expected: number): void {
	assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} differs from ${expected}`);
}

test('CorridorKey preparation retains full raster geometry and the upstream SDR/asinh transfers', () => {
	const rgba = new Uint8Array(PADDED_PIXELS * 4);
	rgba.set([0, 128, 255, 17, 10, 11, 64, 255]);
	const prepared = prepareCorridorKeyPixelsV1({ width: 256, height: 256, rgba });
	assert.equal(prepared.width, 256);
	assert.equal(prepared.height, 256);
	assert.equal(prepared.paddedWidth, 256);
	assert.equal(prepared.paddedHeight, 256);
	assert.equal(prepared.padLeft, 0);
	assert.equal(prepared.padTop, 0);
	assert.equal(prepared.modelRgb.length, PADDED_PIXELS * 3);
	assert.equal(prepared.foundationRgb.length, PADDED_PIXELS * 3);
	approximately(prepared.foundationRgb[0]!, 0);
	approximately(prepared.foundationRgb[PADDED_PIXELS]!, 128 / 255);
	approximately(prepared.foundationRgb[PADDED_PIXELS * 2]!, 1);
	approximately(prepared.modelRgb[0]!, 0);
	approximately(prepared.modelRgb[PADDED_PIXELS]!, ENCODED_MID_GREY);
	approximately(prepared.modelRgb[PADDED_PIXELS * 2]!, ENCODED_WHITE);
	// Bytes 10 and 11 straddle the standard sRGB decoding threshold.
	approximately(prepared.modelRgb[1]!, 0.04471273268261226);
	approximately(prepared.modelRgb[PADDED_PIXELS + 1]!, 0.04906987942858632);
	approximately(prepared.modelRgb[PADDED_PIXELS * 2 + 1]!, ENCODED_DARK_GREY);
	rgba.fill(255);
	assert.equal(prepared.foundationRgb[0], 0, 'prepared tensors own their storage');
});

test('native preparation center-pads with reflect-101 instead of stretching or repeating edges', () => {
	const prepared = prepareCorridorKeyPixelsV1(raster(3, 2, [
		[0, 0, 0, 255], [64, 0, 0, 255], [255, 0, 0, 255],
		[11, 0, 0, 255], [128, 0, 0, 255], [200, 0, 0, 255],
	]));
	assert.deepEqual([prepared.width, prepared.height, prepared.paddedWidth,
		prepared.paddedHeight, prepared.padLeft, prepared.padTop], [3, 2, 256, 256, 126, 127]);
	const red = (x: number, y: number): number => prepared.foundationRgb[y * 256 + x]!;
	for (const [x, byte] of [[124, 255], [125, 64], [126, 0], [127, 64], [128, 255], [129, 64], [130, 0]]) {
		approximately(red(x!, 127), byte! / 255);
	}
	approximately(red(127, 126), 128 / 255);
	approximately(red(127, 128), 128 / 255);
	approximately(red(127, 129), 64 / 255);
	approximately(red(0, 0), 200 / 255);
});

test('one-pixel dimensions replicate safely through arbitrary reflection padding', () => {
	const prepared = prepareCorridorKeyPixelsV1(raster(1, 1, [[255, 128, 64, 0]]));
	assert.deepEqual([prepared.padLeft, prepared.padTop], [127, 127]);
	for (const index of [0, 127 * 256 + 127, PADDED_PIXELS - 1]) {
		approximately(prepared.foundationRgb[index]!, 1);
		approximately(prepared.foundationRgb[PADDED_PIXELS + index]!, 128 / 255);
		approximately(prepared.foundationRgb[PADDED_PIXELS * 2 + index]!, 64 / 255);
	}
});

test('padding crosses shape quanta without reducing the native raster or changing a low-light transfer', () => {
	const rgba = new Uint8Array(257 * 255 * 4);
	rgba.set([10, 11, 255, 255], rgba.length - 4);
	const prepared = prepareCorridorKeyPixelsV1({ width: 257, height: 255, rgba });
	assert.deepEqual([prepared.paddedWidth, prepared.paddedHeight, prepared.padLeft,
		prepared.padTop], [512, 256, 127, 0]);
	const last = 254 * 512 + 127 + 256;
	const pixels = 512 * 256;
	approximately(prepared.foundationRgb[last]!, 10 / 255);
	approximately(prepared.foundationRgb[pixels + last]!, 11 / 255);
	const decoded = decodeCorridorKeyPixelsV1({ width: 257, height: 255,
		alpha: new Float32Array(pixels).fill(1), foreground: prepared.modelRgb });
	assert.equal(decoded.rgba.length, rgba.length);
	assert.deepEqual([...decoded.rgba.slice(-4)], [10, 11, 255, 255]);
});

test('stage-two decoding crops native pixels and retains straight RGB across transparent and soft edges', () => {
	const request = output();
	const first = 127 * 256 + 126;
	request.alpha.set([0, 0.25, 0.5], first);
	const decoded = decodeCorridorKeyPixelsV1(request);
	assert.equal(decoded.width, 3);
	assert.equal(decoded.height, 1);
	assert.deepEqual([...decoded.rgba], [255, 128, 64, 0, 255, 128, 64, 64, 255, 128, 64, 128]);
	request.foreground.fill(0);
	assert.equal(decoded.rgba[0], 255, 'decoded pixels own their storage');
});

test('cropping uses each native sample and clips signed/HDR foreground only at RGBA8 delivery', () => {
	const request = output(2, 2);
	const first = 127 * 256 + 127;
	request.alpha[first] = -0.01;
	request.alpha[first + 1] = 1.01;
	request.alpha[first + 256] = 1 / 255;
	request.foreground[first] = -ENCODED_WHITE;
	request.foreground[first + 1] = 1; // Asinh value 1 decodes to linear 16, not linear 1.
	request.foreground[PADDED_PIXELS + first + 256] = 0;
	request.foreground[PADDED_PIXELS * 2 + first + 257] = 0;
	const decoded = decodeCorridorKeyPixelsV1(request);
	assert.deepEqual([...decoded.rgba], [
		0, 128, 64, 0, 255, 128, 64, 255,
		255, 0, 64, 1, 255, 128, 0, 255,
	]);
});

test('pixel boundaries reject fractional, missing, oversized and nonfinite dimensions', () => {
	for (const dimension of [0, -1, 1.5, NaN, Infinity, 4_097]) {
		assert.throws(() => prepareCorridorKeyPixelsV1({ width: dimension, height: 1,
			rgba: new Uint8Array(4) }), /dimension|width/iu);
		assert.throws(() => decodeCorridorKeyPixelsV1({ ...output(), height: dimension }),
			/dimension|height/iu);
	}
	assert.throws(() => prepareCorridorKeyPixelsV1(null as never), /raster|request/iu);
	assert.throws(() => decodeCorridorKeyPixelsV1(null as never), /output|request/iu);
});

test('preparation and decoding require exact typed storage lengths', () => {
	for (const rgba of [new Uint8Array(3), new Uint8Array(5), [0, 0, 0, 255]]) {
		assert.throws(() => prepareCorridorKeyPixelsV1({ width: 1, height: 1, rgba: rgba as Uint8Array }),
			/RGBA|length/iu);
	}
	for (const alpha of [new Float32Array(PADDED_PIXELS - 1), new Float32Array(PADDED_PIXELS + 1),
		new Float64Array(PADDED_PIXELS)]) {
		assert.throws(() => decodeCorridorKeyPixelsV1({ ...output(), alpha: alpha as Float32Array }),
			/alpha|length/iu);
	}
	for (const foreground of [new Float32Array(PADDED_PIXELS * 3 - 1),
		new Float32Array(PADDED_PIXELS * 3 + 1), new Float64Array(PADDED_PIXELS * 3)]) {
		assert.throws(() => decodeCorridorKeyPixelsV1({ ...output(), foreground: foreground as Float32Array }),
			/foreground|length/iu);
	}
});

test('nonfinite model outputs are refused even when they lie outside the native crop', () => {
	for (const value of [NaN, Infinity, -Infinity]) {
		const alpha = output();
		alpha.alpha[0] = value;
		assert.throws(() => decodeCorridorKeyPixelsV1(alpha), /finite|alpha/iu);
		const foreground = output();
		foreground.foreground[foreground.foreground.length - 1] = value;
		assert.throws(() => decodeCorridorKeyPixelsV1(foreground), /finite|foreground/iu);
	}
	const overflow = output();
	overflow.foreground[127 * 256 + 126] = 1e20;
	assert.throws(() => decodeCorridorKeyPixelsV1(overflow), /finite|foreground/iu);
});
