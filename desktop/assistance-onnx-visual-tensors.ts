/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic CPU image tensor preparation and bounded visual postprocessing. */

import type { AssistanceOnnxTensorV1 } from './assistance-onnx-runtime-worker.ts';

export interface AssistanceVisualCropV1 {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

export interface AssistanceVisualTensorNormalizationV1 {
	readonly channelOrder: 'rgb' | 'bgr';
	readonly mean: readonly [number, number, number];
	readonly standardDeviation: readonly [number, number, number];
	readonly scale: number;
}

export function resizeAssistanceRgbaToChwFloatV1(
	rgba: Uint8Array,
	sourceWidth: number,
	sourceHeight: number,
	targetWidth: number,
	targetHeight: number,
	normalization: AssistanceVisualTensorNormalizationV1,
	crop: AssistanceVisualCropV1 = Object.freeze({ left: 0, top: 0, right: 1, bottom: 1 }),
): Float32Array {
	geometry(sourceWidth, sourceHeight, targetWidth, targetHeight, rgba);
	const region = normalizedCrop(crop);
	const planeLength = targetWidth * targetHeight;
	const result = new Float32Array(3 * planeLength);
	const columns = bilinearAxis(sourceWidth, targetWidth, region.left, region.right, 4);
	const rows = bilinearAxis(sourceHeight, targetHeight, region.top, region.bottom, sourceWidth * 4);
	const { channelOrder, mean, standardDeviation, scale } = normalization;
	for (let y = 0; y < targetHeight; y += 1) {
		const upperRow = rows.first[y]!, lowerRow = rows.second[y]!, yWeight = rows.weights[y]!;
		for (let x = 0; x < targetWidth; x += 1) {
			const left = columns.first[x]!, right = columns.second[x]!, xWeight = columns.weights[x]!;
			const offset = y * targetWidth + x;
			for (let channel = 0; channel < 3; channel += 1) {
				const component = channelOrder === 'rgb' ? channel : 2 - channel;
				const top = rgba[upperRow + left + component]! * (1 - xWeight)
					+ rgba[upperRow + right + component]! * xWeight;
				const bottom = rgba[lowerRow + left + component]! * (1 - xWeight)
					+ rgba[lowerRow + right + component]! * xWeight;
				const scaled = (top * (1 - yWeight) + bottom * yWeight) * scale;
				result[channel * planeLength + offset] = Math.fround((scaled - mean[channel]!) / standardDeviation[channel]!);
			}
		}
	}
	return result;
}

function bilinearAxis(sourceLength: number, targetLength: number, start: number, end: number, stride: number) {
	const first = new Uint32Array(targetLength), second = new Uint32Array(targetLength);
	const weights = new Float64Array(targetLength);
	const extent = end - start;
	for (let index = 0; index < targetLength; index++) {
		const coordinate = (start + (index + 0.5) / targetLength * extent) * sourceLength - 0.5;
		const clamped = Math.max(0, Math.min(sourceLength - 1, coordinate));
		const before = Math.floor(clamped);
		first[index] = before * stride;
		second[index] = Math.min(sourceLength - 1, before + 1) * stride;
		weights[index] = clamped - before;
	}
	return { first, second, weights };
}

export function exactAssistanceFloatTensorV1(
	value: AssistanceOnnxTensorV1 | undefined,
	dims: readonly number[],
	label: string,
): Float32Array {
	if (!value || value.type !== 'float32' || !(value.data instanceof Float32Array)
		|| JSON.stringify(value.dims) !== JSON.stringify(dims)
		|| value.data.length !== dims.reduce((product, item) => product * item, 1)) {
		throw new RangeError(`The ${label} tensor geometry or element type is invalid.`);
	}
	for (const candidate of value.data) {
		if (!Number.isFinite(candidate)) throw new RangeError(`The ${label} tensor is non-finite.`);
	}
	return value.data;
}

export function normalizeAssistanceEmbeddingV1(
	value: ArrayLike<number>,
	label: string,
): Float32Array {
	let normSquared = 0;
	for (let index = 0; index < value.length; index += 1) {
		const candidate = value[index];
		if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
			throw new RangeError(`The ${label} embedding is non-finite.`);
		}
		normSquared += candidate * candidate;
	}
	const norm = Math.sqrt(normSquared);
	if (!Number.isFinite(norm) || norm < 1e-12) {
		throw new RangeError(`The ${label} embedding cannot be normalized.`);
	}
	const result = new Float32Array(value.length);
	for (let index = 0; index < value.length; index += 1) {
		result[index] = Math.fround(value[index]! / norm);
	}
	return result;
}

export function assistanceSigmoidV1(value: number, label: string): number {
	if (!Number.isFinite(value)) throw new RangeError(`The ${label} logit is non-finite.`);
	return Math.fround(value >= 0 ? 1 / (1 + Math.exp(-value))
		: Math.exp(value) / (1 + Math.exp(value)));
}

export function assistanceNormalizedBoxV1(
	leftValue: number,
	topValue: number,
	rightValue: number,
	bottomValue: number,
): Readonly<{ x: number; y: number; width: number; height: number }> | null {
	if (![leftValue, topValue, rightValue, bottomValue].every(Number.isFinite)) {
		throw new RangeError('A visual detection box is non-finite.');
	}
	const left = Math.min(1, Math.max(0, leftValue));
	const top = Math.min(1, Math.max(0, topValue));
	const right = Math.min(1, Math.max(0, rightValue));
	const bottom = Math.min(1, Math.max(0, bottomValue));
	if (right - left < 1e-6 || bottom - top < 1e-6) return null;
	return Object.freeze({ x: Math.fround(left), y: Math.fround(top),
		width: Math.fround(right - left), height: Math.fround(bottom - top) });
}

export function assistanceBoxIouV1(
	left: Readonly<{ x: number; y: number; width: number; height: number }>,
	right: Readonly<{ x: number; y: number; width: number; height: number }>,
): number {
	const intersectionWidth = Math.max(0,
		Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
	const intersectionHeight = Math.max(0,
		Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
	const intersection = intersectionWidth * intersectionHeight;
	const union = left.width * left.height + right.width * right.height - intersection;
	return union <= 0 ? 0 : intersection / union;
}

function normalizedCrop(value: AssistanceVisualCropV1): AssistanceVisualCropV1 {
	if (![value?.left, value?.top, value?.right, value?.bottom].every((candidate) =>
		typeof candidate === 'number' && Number.isFinite(candidate)
		&& candidate >= 0 && candidate <= 1)
		|| value.right <= value.left || value.bottom <= value.top) {
		throw new RangeError('A visual tensor crop is outside normalized frame geometry.');
	}
	return value;
}

function geometry(
	sourceWidth: number,
	sourceHeight: number,
	targetWidth: number,
	targetHeight: number,
	rgba: Uint8Array,
): void {
	if (![sourceWidth, sourceHeight, targetWidth, targetHeight].every((candidate) =>
		Number.isSafeInteger(candidate) && candidate > 0 && candidate <= 4_096)
		|| !(rgba instanceof Uint8Array)
		|| rgba.byteLength !== sourceWidth * sourceHeight * 4) {
		throw new RangeError('Visual tensor preparation received invalid RGBA geometry.');
	}
}
