/* SPDX-License-Identifier: AGPL-3.0-only */

/** Native-resolution SDR pixel boundary for CorridorKey 2.0, without resizing or premultiplication. */

// The pinned upstream corridorkey/color_utils.py defines this signed HDR encoding.
const ASINH_KNEE = 0.008;
const ASINH_REFERENCE = 16.0;
const ASINH_DENOMINATOR = Math.asinh(ASINH_REFERENCE / ASINH_KNEE);
// The dynamic ONNX graph uses a 256-pixel quantum to keep shifted attention windows exact.
const SHAPE_QUANTUM = 256;
const MAXIMUM_DIMENSION = 4_096;
const SDR_TO_MODEL = Float32Array.from({ length: 256 }, (_, byte) => {
	const srgb = byte / 255;
	const linear = srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
	return Math.asinh(linear / ASINH_KNEE) / ASINH_DENOMINATOR;
});

export interface CorridorKeyRasterV1 {
	readonly width: number;
	readonly height: number;
	readonly rgba: Uint8Array;
}

export interface CorridorKeyPixelGeometryV1 {
	readonly width: number;
	readonly height: number;
	readonly paddedWidth: number;
	readonly paddedHeight: number;
	readonly padLeft: number;
	readonly padTop: number;
}

export interface CorridorKeyPreparedPixelsV1 extends CorridorKeyPixelGeometryV1 {
	/** One frame in planar CHW order, signed asinh encoded scene-linear RGB. */
	readonly modelRgb: Float32Array;
	/** The same padded frame in planar CHW order, sRGB values in [0, 1] for foundation models. */
	readonly foundationRgb: Float32Array;
}

export interface CorridorKeyOutputPixelsV1 {
	/** Native source dimensions; padded output dimensions are derived identically to preparation. */
	readonly width: number;
	readonly height: number;
	/** Stage-two raw alpha plane at padded resolution; values are clamped, never sigmoided. */
	readonly alpha: Float32Array;
	/** Stage-two straight foreground in padded CHW order, with the model's signed asinh encoding. */
	readonly foreground: Float32Array;
}

/**
 * Preserve every source pixel and center-pad to the dynamic graph's 256-pixel shape quantum.
 * Reflection excludes the edge pixel, matching upstream OpenCV BORDER_REFLECT_101.
 * Input alpha is not a network hint; the caller owns any separate hint contract.
 * Callers add the model's batch/time axes to these single-frame CHW tensors.
 */
export function prepareCorridorKeyPixelsV1(request: CorridorKeyRasterV1): CorridorKeyPreparedPixelsV1 {
	const geometry = pixelGeometry(request, 'raster request');
	if (!(request.rgba instanceof Uint8Array)
		|| request.rgba.length !== geometry.width * geometry.height * 4) {
		throw new TypeError('CorridorKey input RGBA must have its exact native Uint8Array length.');
	}
	const pixels = geometry.paddedWidth * geometry.paddedHeight;
	const modelRgb = new Float32Array(pixels * 3);
	const foundationRgb = new Float32Array(pixels * 3);
	const columns = Int32Array.from({ length: geometry.paddedWidth }, (_, x) =>
		reflectCoordinate(x - geometry.padLeft, geometry.width) * 4);
	for (let y = 0; y < geometry.paddedHeight; y += 1) {
		const sourceRow = reflectCoordinate(y - geometry.padTop, geometry.height) * geometry.width * 4;
		for (let x = 0; x < geometry.paddedWidth; x += 1) {
			const source = sourceRow + columns[x]!;
			const target = y * geometry.paddedWidth + x;
			for (let channel = 0; channel < 3; channel += 1) {
				const byte = request.rgba[source + channel]!;
				modelRgb[channel * pixels + target] = SDR_TO_MODEL[byte]!;
				foundationRgb[channel * pixels + target] = byte / 255;
			}
		}
	}
	return Object.freeze({ ...geometry, modelRgb, foundationRgb });
}

/**
 * Validate stage-two float32 planes, remove reflection padding, and deliver straight sRGB RGBA8.
 * Fractional alpha remains independent of RGB, including completely transparent pixels.
 * Signed/HDR model foreground is decoded before clipping to the SDR delivery range.
 */
export function decodeCorridorKeyPixelsV1(request: CorridorKeyOutputPixelsV1): CorridorKeyRasterV1 {
	const geometry = pixelGeometry(request, 'output request');
	const pixels = geometry.paddedWidth * geometry.paddedHeight;
	const alpha = finitePlane(request.alpha, pixels, 'alpha');
	const foreground = finitePlane(request.foreground, pixels * 3, 'foreground');
	const rgba = new Uint8Array(geometry.width * geometry.height * 4);
	for (let y = 0; y < geometry.height; y += 1) {
		for (let x = 0; x < geometry.width; x += 1) {
			const source = (geometry.padTop + y) * geometry.paddedWidth + geometry.padLeft + x;
			const target = (y * geometry.width + x) * 4;
			for (let channel = 0; channel < 3; channel += 1) {
				const linear = Math.sinh(foreground[channel * pixels + source]! * ASINH_DENOMINATOR) * ASINH_KNEE;
				if (!Number.isFinite(linear)) {
					throw new RangeError('CorridorKey foreground must decode to finite scene-linear values.');
				}
				const magnitude = Math.abs(linear);
				const srgb = magnitude <= 0.0031308 ? magnitude * 12.92
					: 1.055 * magnitude ** (1 / 2.4) - 0.055;
				rgba[target + channel] = toByte(Math.sign(linear) * srgb);
			}
			rgba[target + 3] = toByte(alpha[source]!);
		}
	}
	return Object.freeze({ width: geometry.width, height: geometry.height, rgba });
}

function pixelGeometry(value: Readonly<{ width: number; height: number }>, label: string): CorridorKeyPixelGeometryV1 {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError(`CorridorKey ${label} must describe a pixel raster.`);
	}
	const width = dimension(value.width, 'width');
	const height = dimension(value.height, 'height');
	const paddedWidth = Math.ceil(width / SHAPE_QUANTUM) * SHAPE_QUANTUM;
	const paddedHeight = Math.ceil(height / SHAPE_QUANTUM) * SHAPE_QUANTUM;
	return Object.freeze({ width, height, paddedWidth, paddedHeight,
		padLeft: Math.floor((paddedWidth - width) / 2),
		padTop: Math.floor((paddedHeight - height) / 2) });
}

function dimension(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > MAXIMUM_DIMENSION) {
		throw new RangeError(`CorridorKey ${name} dimension must be between 1 and ${MAXIMUM_DIMENSION}.`);
	}
	return value;
}

function reflectCoordinate(value: number, length: number): number {
	if (length === 1) return 0;
	const period = 2 * (length - 1);
	const repeated = ((value % period) + period) % period;
	return repeated < length ? repeated : period - repeated;
}

function finitePlane(value: Float32Array, expectedLength: number, label: string): Float32Array {
	if (!(value instanceof Float32Array) || value.length !== expectedLength) {
		throw new TypeError(`CorridorKey ${label} must have its exact padded Float32Array length.`);
	}
	for (const sample of value) {
		if (!Number.isFinite(sample)) throw new RangeError(`CorridorKey ${label} samples must be finite.`);
	}
	return value;
}

function toByte(value: number): number {
	return Math.round(Math.max(0, Math.min(1, value)) * 255);
}
