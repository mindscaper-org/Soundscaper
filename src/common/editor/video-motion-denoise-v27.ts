/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createGrayVideoFrameV1,
	prepareSimilarityAffineCoefficientsV1,
	resolveStabilizationTransformV1,
	type GrayVideoFrameV1,
	type VideoSimilarityTransformV1,
} from './video-motion-processing-v27.ts';
import { sampleGrayVideoFrameBilinearV1 } from './gray-video-frame-sampling-v1.ts';

export interface VideoTemporalNeighborV1 {
	readonly frame: GrayVideoFrameV1;
	/** Maps the neighbor's pixel coordinates into the current frame. */
	readonly transformToCurrent: VideoSimilarityTransformV1;
}

export interface VideoMotionWebGl2AcceleratorV1 {
	readonly kind: 'webgl2';
	temporalDenoise(request: Readonly<{
		current: GrayVideoFrameV1;
		neighbors: readonly VideoTemporalNeighborV1[];
		strength: number;
		signal?: AbortSignal;
	}>): Promise<GrayVideoFrameV1>;
}

export async function processTemporalDenoiseV1(request: Readonly<{
	readonly current: GrayVideoFrameV1;
	readonly neighbors: readonly VideoTemporalNeighborV1[];
	readonly strength: number;
	readonly accelerator?: VideoMotionWebGl2AcceleratorV1;
	readonly signal?: AbortSignal;
	readonly onAcceleratorFallback?: (reason: string) => void;
}>): Promise<GrayVideoFrameV1> {
	throwIfAborted(request?.signal);
	const current = frameValue(request?.current, 'temporal denoise current frame');
	if (!Array.isArray(request?.neighbors) || request.neighbors.length > 16) {
		throw new RangeError('Temporal denoise neighbors exceed their bound.');
	}
	const neighbors = request.neighbors.map((neighbor, index) => neighborValue(
		neighbor, current, `temporal denoise neighbor ${String(index)}`,
	));
	const strength = bounded(request?.strength, 0, 1, 'temporal denoise strength');
	const processCpu = () => finishDenoiseRowsCooperatively(
		temporalDenoiseRows(current, neighbors, strength, request.signal), request.signal,
	);
	if (!request.accelerator) return processCpu();
	if (request.accelerator.kind !== 'webgl2') throw new TypeError('The motion accelerator must be WebGL2.');
	try {
		const accelerated = frameValue(await request.accelerator.temporalDenoise({
			current, neighbors, strength, ...(request.signal ? { signal: request.signal } : {}),
		}), 'accelerated temporal denoise frame');
		throwIfAborted(request.signal);
		if (accelerated.width !== current.width || accelerated.height !== current.height) {
			throw new RangeError('WebGL2 temporal denoise changed the frame geometry.');
		}
		return accelerated;
	} catch (error) {
		throwIfAborted(request.signal);
		request.onAcceleratorFallback?.(`WebGL2 temporal denoise was unavailable; deterministic CPU fallback was used: ${errorMessage(error)}`);
	}
	return processCpu();
}

interface SpatialDenoiseOptions {
	readonly radius: number;
	readonly strength: number;
	readonly signal?: AbortSignal;
}

/** Synchronous scalar oracle, sharing the bounded sliding-window kernel. */
export function processSpatialDenoiseV1(
	frameValueInput: GrayVideoFrameV1, options: Readonly<SpatialDenoiseOptions>,
): GrayVideoFrameV1 {
	const work = spatialDenoiseRows(frameValueInput, options);
	let result = work.next();
	while (!result.done) result = work.next();
	return result.value;
}

/** Preview/export release the event loop between bounded row groups so abort can arrive. */
export async function processSpatialDenoiseCooperativeV1(
	frameValueInput: GrayVideoFrameV1, options: Readonly<SpatialDenoiseOptions>,
): Promise<GrayVideoFrameV1> {
	return finishDenoiseRowsCooperatively(spatialDenoiseRows(frameValueInput, options), options.signal);
}

async function finishDenoiseRowsCooperatively(
	work: Generator<void, GrayVideoFrameV1>, signal: AbortSignal | undefined,
): Promise<GrayVideoFrameV1> {
	throwIfAborted(signal);
	let result = work.next();
	if (result.done) return result.value;
	const setImmediate = (globalThis as typeof globalThis & {
		readonly setImmediate?: (callback: () => void) => void;
	}).setImmediate;
	// Node drains recursive messages from one port before servicing other tasks.
	const tasks = !setImmediate && typeof MessageChannel === 'function' ? new MessageChannel() : null;
	const scheduleTask = setImmediate ?? ((callback: () => void) => { globalThis.setTimeout(callback, 0); });
	try {
		while (!result.done) {
			await new Promise<void>((resolve) => {
				// Ordinary tasks admit queued cancellation without nested timer clamping.
				if (!tasks) {
					scheduleTask(resolve);
					return;
				}
				tasks.port1.onmessage = () => resolve();
				tasks.port2.postMessage(null);
			});
			throwIfAborted(signal);
			result = work.next();
		}
		return result.value;
	} finally {
		tasks?.port1.close();
		tasks?.port2.close();
	}
}

function* spatialDenoiseRows(
	frameValueInput: GrayVideoFrameV1, options: Readonly<SpatialDenoiseOptions>,
): Generator<void, GrayVideoFrameV1> {
	throwIfAborted(options.signal);
	const frame = frameValue(frameValueInput, 'spatial denoise frame');
	const radius = boundedInteger(options?.radius, 1, 16, 'spatial denoise radius');
	const strength = bounded(options?.strength, 0, 1, 'spatial denoise strength');
	if (strength === 0) return frame;
	const { width, height } = frame;
	const diameter = radius * 2 + 1;
	// Keep the active vertical window and one entering row. The extra slot
	// preserves the leaving row until the column totals have been updated.
	const bufferedRows = Math.min(height, diameter + 1);
	const horizontal = new Float64Array(width * bufferedRows);
	const horizontalOffset = (y: number): number => (y % bufferedRows) * width;
	for (let y = 0; y <= radius && y < height; y += 1) {
		throwIfAborted(options.signal);
		spatialDenoiseHorizontalRow(frame, y, radius, diameter, horizontal, horizontalOffset(y));
	}
	const columns = new Float64Array(width);
	for (let y = -radius; y <= radius; y += 1) {
		const offset = horizontalOffset(Math.max(0, Math.min(height - 1, y)));
		for (let x = 0; x < width; x += 1) columns[x] = columns[x]! + horizontal[offset + x]!;
	}
	const samples = new Array<number>(width * height);
	for (let y = 0; y < height; y += 1) {
		throwIfAborted(options.signal);
		const enteringRow = y + radius + 1;
		const entering = horizontalOffset(Math.min(height - 1, enteringRow));
		const leaving = horizontalOffset(Math.max(0, y - radius));
		if (enteringRow < height) {
			spatialDenoiseHorizontalRow(frame, enteringRow, radius, diameter, horizontal, entering);
		}
		const output = y * width;
		for (let x = 0; x < width; x += 1) {
			const original = frame.samples[output + x]!;
			const value = original + (columns[x]! / diameter - original) * strength;
			samples[output + x] = Math.max(0, Math.min(1, value));
			columns[x] = columns[x]! + horizontal[entering + x]! - horizontal[leaving + x]!;
		}
		if ((y & 15) === 15) yield;
	}
	return createGrayVideoFrameV1({ width, height, samples });
}

function spatialDenoiseHorizontalRow(
	frame: GrayVideoFrameV1, y: number, radius: number, diameter: number,
	horizontal: Float64Array, offset: number,
): void {
	const { width, samples } = frame;
	const row = y * width;
	let sum = 0;
	for (let x = -radius; x <= radius; x += 1) {
		sum += samples[row + Math.max(0, Math.min(width - 1, x))]!;
	}
	for (let x = 0; x < width; x += 1) {
		horizontal[offset + x] = sum / diameter;
		sum += samples[row + Math.min(width - 1, x + radius + 1)]! - samples[row + Math.max(0, x - radius)]!;
	}
}

function* temporalDenoiseRows(
	current: GrayVideoFrameV1,
	neighbors: readonly VideoTemporalNeighborV1[],
	strength: number,
	signal?: AbortSignal,
): Generator<void, GrayVideoFrameV1> {
	const samples: number[] = [];
	const resolvedNeighbors = neighbors.map((neighbor) => ({
		frame: neighbor.frame,
		...prepareSimilarityAffineCoefficientsV1(resolveStabilizationTransformV1(neighbor.transformToCurrent, 1)),
	}));
	const rowsPerTask = Math.max(1, Math.min(16, Math.floor(131_072 / (current.width * (neighbors.length + 1)))));
	for (let y = 0; y < current.height; y += 1) {
		throwIfAborted(signal);
		for (let x = 0; x < current.width; x += 1) {
			const original = pixel(current, x, y);
			let total = original;
			let count = 1;
			for (const { frame, cosine, sine, translateX, translateY } of resolvedNeighbors) {
				const neighborX = cosine * x - sine * y + translateX;
				const neighborY = sine * x + cosine * y + translateY;
				if (!inside(frame, neighborX, neighborY)) continue;
				total += sampleGrayVideoFrameBilinearV1(frame, neighborX, neighborY);
				count += 1;
			}
			samples.push(original + (total / count - original) * strength);
		}
		if ((y + 1) % rowsPerTask === 0 && y + 1 < current.height) yield;
	}
	return createGrayVideoFrameV1({ width: current.width, height: current.height, samples });
}

function neighborValue(
	value: VideoTemporalNeighborV1,
	current: GrayVideoFrameV1,
	name: string,
): VideoTemporalNeighborV1 {
	if (!value || typeof value !== 'object') throw new TypeError(`${name} must be an object.`);
	const frame = frameValue(value.frame, `${name} frame`);
	if (frame.width !== current.width || frame.height !== current.height) {
		throw new RangeError(`${name} dimensions do not match the current frame.`);
	}
	// Resolving the exact inverse validates every similarity scalar.
	resolveStabilizationTransformV1(value.transformToCurrent, 1);
	return Object.freeze({ frame, transformToCurrent: Object.freeze({ ...value.transformToCurrent }) });
}

function frameValue(value: unknown, name: string): GrayVideoFrameV1 {
	if (!value || typeof value !== 'object') throw new TypeError(`${name} must be a gray frame.`);
	return createGrayVideoFrameV1(value as GrayVideoFrameV1);
}

function pixel(frame: GrayVideoFrameV1, x: number, y: number): number {
	return frame.samples[y * frame.width + x]!;
}

function inside(frame: GrayVideoFrameV1, x: number, y: number): boolean {
	return x >= 0 && y >= 0 && x <= frame.width - 1 && y <= frame.height - 1;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`${name} is outside its integer bound.`);
	}
	return Number(value);
}

function bounded(value: unknown, minimum: number, maximum: number, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new RangeError(`${name} is outside its finite bound.`);
	}
	return Object.is(value, -0) ? 0 : value;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason instanceof Error) throw signal.reason;
	throw new DOMException('The motion operation was aborted.', 'AbortError');
}

function errorMessage(value: unknown): string {
	return value instanceof Error ? value.message : String(value);
}
