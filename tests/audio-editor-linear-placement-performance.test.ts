/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { placeUnifiedExactLinearRgbaFrameV13 } from '../src/common/editor/unified-exact-linear-rgba-v13.ts';

test('axis-aligned exact placement prepares interpolation addresses per row and column', () => {
	const floor = Math.floor;
	let addressCalculations = 0;
	Math.floor = (value: number): number => { addressCalculations += 1; return floor(value); };
	try {
		placeUnifiedExactLinearRgbaFrameV13(fixture(0));
	} finally { Math.floor = floor; }
	assert.ok(addressCalculations <= 19 + 13 + 4,
		`expected row/column address preparation, received ${String(addressCalculations)} floors`);
});

test('exact placement retains every Float64 bit across scaled, mirrored, cropped and rotated pictures', () => {
	const digest = createHash('sha256');
	const bytes = Buffer.alloc(8);
	for (let variant = 0; variant < 96; variant += 1) {
		const result = placeUnifiedExactLinearRgbaFrameV13(fixture(variant));
		for (const channel of result.pixels) {
			bytes.writeDoubleLE(channel);
			digest.update(bytes);
		}
	}
	// Captured from the original affine kernel before row/column preparation.
	assert.equal(digest.digest('hex'), '126ca21e744da124d19b9e53b8b5b392a6fa90099cc01edca4ff38ff5a81b787');
});

test('axis-aligned placement retains frame, mask and singular-transform admission', () => {
	const request = fixture(1);
	const invalid = new Float32Array(request.frame.pixels);
	invalid[0] = Number.NaN;
	assert.throws(() => placeUnifiedExactLinearRgbaFrameV13({
		...request, frame: { ...request.frame, pixels: invalid }, opacity: 0,
	}), /between zero and one/u);
	assert.throws(() => placeUnifiedExactLinearRgbaFrameV13({
		...request, mask: new Uint8Array(1),
	}), /match the output geometry/u);
	const renderDescription = request.renderDescription as Readonly<Record<string, unknown>>;
	assert.throws(() => placeUnifiedExactLinearRgbaFrameV13({
		...request, renderDescription: { ...renderDescription, sourceDisplayToCanvas: [0, 0, 0, 1, 0, 0] },
	}), /singular/u);
});

test('accessor-backed frame dimensions retain live reads through the affine path', () => {
	const request = fixture(0);
	let widthReads = 0;
	const pixels = request.frame.pixels;
	assert.ok(pixels instanceof Uint8Array);
	const frame = {
		get width() { widthReads += 1; return 11; },
		height: request.frame.height, pixels,
	};
	const expected = placeUnifiedExactLinearRgbaFrameV13(request);
	assert.deepEqual(placeUnifiedExactLinearRgbaFrameV13({ ...request, frame }).pixels, expected.pixels);
	assert.ok(widthReads > request.outputWidth * request.outputHeight);
});

function fixture(variant: number): Parameters<typeof placeUnifiedExactLinearRgbaFrameV13>[0] {
	const float = variant % 2 === 1;
	const width = 11, height = 7;
	const values = Array.from({ length: width * height * 4 }, (_unused, index) => (
		((index * 73 + variant * 29) % 256) / (float ? 255 : 1)
	));
	const crop = variant % 3 === 0
		? { left: 0, top: 0, right: 0, bottom: 0 }
		: { left: 0.13, top: 0.19, right: 0.17, bottom: 0.23 };
	const transforms = [
		[1.7, 0, 0, 1.7, 0, 0], [1, 0, 0, 1, 0, 0],
		[1.3, 0, 0, 0.8, 0.3, -0.2], [-1.4, 0, 0, 1.2, 17, 0.4],
		[0.8, 0.4, -0.4, 0.8, 2, -1], [0.9, 0, 0, -1.3, 0.5, 11],
		[-0.7, 0, 0, -1.2, 15, 12], [1, 0, 0, 1, 0.5, 0.5],
	];
	return {
		frame: float ? { width, height, pixels: Float32Array.from(values) }
			: { width, height, pixels: Uint8Array.from(values) },
		displayWidth: width, displayHeight: height, outputWidth: 19, outputHeight: 13,
		renderDescription: {
			crop: { normalized: crop, sourcePixels: {
				x: crop.left * width, y: crop.top * height,
				width: (1 - crop.left - crop.right) * width,
				height: (1 - crop.top - crop.bottom) * height,
			} },
			sourceDisplayToCanvas: transforms[variant % transforms.length],
			opacityStart: variant % 4 === 0 ? 1 : 0.7,
			opacityEnd: 0.3, blendMode: 'normal', compositingOrder: 0,
		},
		intervalProgress: (variant % 7) / 7, opacity: (variant % 5) / 4,
		...(variant % 3 === 0 ? {} : {
			mask: Uint8Array.from({ length: 19 * 13 }, (_unused, index) => (index * 29) % 256),
		}),
	};
}
