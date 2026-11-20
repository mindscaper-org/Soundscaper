/* SPDX-License-Identifier: AGPL-3.0-only */

/** Browser-owned exact frame preparation for model-based selected-video analysis. */

import {
	ASSISTANCE_BINARY_MAXIMUM_BYTES,
	createAssistanceFramePackV1,
} from '../../../../assistance/binary-formats-v1.ts';
import {
	ASSISTANCE_VISUAL_MAXIMUM_SOURCE_DIMENSION,
	createAssistanceVisualFramePackV2,
} from '../../../../assistance/visual-frame-pack-v2.ts';
import {
	ASSISTANCE_TRANSNET_V2_HEIGHT,
	ASSISTANCE_TRANSNET_V2_WIDTH,
} from '../../../../assistance/transnetv2-onnx-adapter-v1.ts';
import type {
	LocalAssistanceSelectedVideoFramePackTiming,
} from './local-assistance-selected-video-timing.ts';
import type { VideoTimingIndex } from '../../../../video-timing-asset.ts';

export const LOCAL_ASSISTANCE_FRAME_PACK_MEDIA_TYPE =
	'application/vnd.soundscaper.frame-pack';
export const LOCAL_ASSISTANCE_VIDEO_FRAMES_PER_PACK = 8_192;
export const LOCAL_ASSISTANCE_VIDEO_MAXIMUM_FRAME_PACKS = 64;
export const LOCAL_ASSISTANCE_REFRAME_MAXIMUM_RASTER_DIMENSION = 320;
export const LOCAL_ASSISTANCE_VISUAL_FRAMES_PER_PACK = 1_024;

export interface LocalAssistanceDecodedVideoFrame {
	readonly width: number;
	readonly height: number;
	readonly rgba: Uint8Array;
}

export interface LocalAssistanceSelectedVideoFrameDecoder {
	capture(request: Readonly<{
		readonly timestampSeconds: number;
		readonly signal: AbortSignal;
	}>): PromiseLike<LocalAssistanceDecodedVideoFrame> | LocalAssistanceDecodedVideoFrame;
	dispose(): PromiseLike<void> | void;
}

export interface LocalAssistanceSelectedVideoFramePackRequest {
	readonly body: Blob;
	readonly timing: LocalAssistanceSelectedVideoFramePackTiming;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
}

export interface LocalAssistanceSelectedVideoVisualFramePackRequest
	extends LocalAssistanceSelectedVideoFramePackRequest {
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	readonly rasterWidth: number;
	readonly rasterHeight: number;
}

export interface LocalAssistanceSelectedVideoFramePackOptions {
	readonly createDecoder?: (
		body: Blob,
		options: Readonly<{
			readonly signal: AbortSignal;
			readonly width: number;
			readonly height: number;
		}>,
	) => PromiseLike<LocalAssistanceSelectedVideoFrameDecoder>
		| LocalAssistanceSelectedVideoFrameDecoder;
	readonly framesPerPack?: number;
}

export async function createLocalAssistanceSelectedVideoFramePacksV1(
	request: LocalAssistanceSelectedVideoFramePackRequest,
	options: LocalAssistanceSelectedVideoFramePackOptions = {},
): Promise<readonly Blob[]> {
	const normalized = normalizeRequest(request);
	if (options.createDecoder !== undefined && typeof options.createDecoder !== 'function') {
		throw new TypeError('Selected-video frame packing needs a decoder factory.');
	}
	const framesPerPack = integer(options.framesPerPack ?? LOCAL_ASSISTANCE_VIDEO_FRAMES_PER_PACK,
		1, LOCAL_ASSISTANCE_VIDEO_FRAMES_PER_PACK, 'selected-video frames per pack');
	const packCount = Math.ceil(normalized.timing.frames.length / framesPerPack);
	if (packCount < 1 || packCount > LOCAL_ASSISTANCE_VIDEO_MAXIMUM_FRAME_PACKS) {
		throw new RangeError('Selected-video frame packing exceeds its bounded pack inventory.');
	}
	const decoder = await openDecoder(normalized, options.createDecoder,
		ASSISTANCE_TRANSNET_V2_WIDTH, ASSISTANCE_TRANSNET_V2_HEIGHT);
	const packs: Blob[] = [];
	try {
		for (let packIndex = 0; packIndex < packCount; packIndex += 1) {
			const first = packIndex * framesPerPack;
			const timings = normalized.timing.frames.slice(first, first + framesPerPack);
			const frames = [];
			for (const timing of timings) {
				assertReady(normalized);
				const decoded = reviewedFrame(await decoder.capture(Object.freeze({
					timestampSeconds: timing.timestampSeconds,
					signal: normalized.signal,
				})));
				assertReady(normalized);
				frames.push(Object.freeze({
					sourceFrame: timing.sourceFrame,
					presentationTick: timing.presentationTick,
					rgba: exactGeometry(decoded,
						ASSISTANCE_TRANSNET_V2_WIDTH, ASSISTANCE_TRANSNET_V2_HEIGHT),
				}));
			}
			const chunks = createAssistanceFramePackV1({
				width: ASSISTANCE_TRANSNET_V2_WIDTH,
				height: ASSISTANCE_TRANSNET_V2_HEIGHT,
				timescale: normalized.timing.timescale,
				frames,
			});
			packs.push(new Blob(chunks.map((chunk) => Uint8Array.from(chunk).buffer), {
				type: LOCAL_ASSISTANCE_FRAME_PACK_MEDIA_TYPE,
			}));
		}
		assertReady(normalized);
		return Object.freeze(packs);
	} finally {
		await decoder.dispose();
	}
}

/** Emit one bounded visual pack with exact source geometry and a separate model raster. */
export async function createLocalAssistanceSelectedVideoVisualFramePackV2(
	request: LocalAssistanceSelectedVideoVisualFramePackRequest,
	options: LocalAssistanceSelectedVideoFramePackOptions = {},
): Promise<Blob> {
	const packs = await createLocalAssistanceSelectedVideoVisualFramePacksV2(request, {
		...options, framesPerPack: request.timing.frames.length,
	});
	if (packs.length !== 1) throw new RangeError('Selected-video visual packing requires one exact pack.');
	return packs[0]!;
}

/** Emit ordered bounded visual packs without retaining all decoded long-media frames at once. */
export async function createLocalAssistanceSelectedVideoVisualFramePacksV2(
	request: LocalAssistanceSelectedVideoVisualFramePackRequest,
	options: LocalAssistanceSelectedVideoFramePackOptions = {},
): Promise<readonly Blob[]> {
	const normalized = normalizeRequest(request);
	const sourceWidth = integer(request.sourceWidth, 1, ASSISTANCE_VISUAL_MAXIMUM_SOURCE_DIMENSION, 'visual source width');
	const sourceHeight = integer(request.sourceHeight, 1, ASSISTANCE_VISUAL_MAXIMUM_SOURCE_DIMENSION, 'visual source height');
	const rasterWidth = integer(request.rasterWidth, 1,
		LOCAL_ASSISTANCE_REFRAME_MAXIMUM_RASTER_DIMENSION, 'visual raster width');
	const rasterHeight = integer(request.rasterHeight, 1,
		LOCAL_ASSISTANCE_REFRAME_MAXIMUM_RASTER_DIMENSION, 'visual raster height');
	if (options.createDecoder !== undefined && typeof options.createDecoder !== 'function') {
		throw new TypeError('Selected-video visual packing needs a decoder factory.');
	}
	const frameBytes = BigInt(rasterWidth) * BigInt(rasterHeight) * 4n + 16n;
	const maximumFramesPerPack = Number((BigInt(ASSISTANCE_BINARY_MAXIMUM_BYTES) - 128n)
		/ frameBytes);
	const framesPerPack = integer(options.framesPerPack
		?? Math.min(LOCAL_ASSISTANCE_VISUAL_FRAMES_PER_PACK, maximumFramesPerPack),
	1, maximumFramesPerPack, 'visual frames per pack');
	const packCount = Math.ceil(normalized.timing.frames.length / framesPerPack);
	if (packCount < 1 || packCount > LOCAL_ASSISTANCE_VIDEO_MAXIMUM_FRAME_PACKS) {
		throw new RangeError('Selected-video visual packing exceeds its bounded pack inventory.');
	}
	assertReady(normalized);
	const decoder = await openDecoder(normalized, options.createDecoder, rasterWidth, rasterHeight);
	const packs: Blob[] = [];
	try {
		for (let packIndex = 0; packIndex < packCount; packIndex += 1) {
			const first = packIndex * framesPerPack;
			const timings = normalized.timing.frames.slice(first, first + framesPerPack);
			const frames = [];
			for (const timing of timings) {
				assertReady(normalized);
				const decoded = reviewedFrame(await decoder.capture(Object.freeze({
					timestampSeconds: timing.timestampSeconds, signal: normalized.signal,
				})));
				assertReady(normalized);
				frames.push(Object.freeze({ sourceFrame: timing.sourceFrame,
					presentationTick: timing.presentationTick,
					rgba: exactGeometry(decoded, rasterWidth, rasterHeight) }));
			}
			const chunks = createAssistanceVisualFramePackV2({ sourceWidth, sourceHeight,
				rasterWidth, rasterHeight, timescale: normalized.timing.timescale, frames });
			packs.push(new Blob(chunks.map((chunk) => Uint8Array.from(chunk).buffer), {
				type: LOCAL_ASSISTANCE_FRAME_PACK_MEDIA_TYPE,
			}));
		}
		assertReady(normalized);
		return Object.freeze(packs);
	} finally {
		await decoder.dispose();
	}
}

function normalizeRequest(
	request: LocalAssistanceSelectedVideoFramePackRequest,
): LocalAssistanceSelectedVideoFramePackRequest {
	if (!request || typeof request !== 'object' || !(request.body instanceof Blob)
		|| request.body.size < 1 || !(request.signal instanceof AbortSignal)
		|| typeof request.assertCurrent !== 'function') {
		throw new TypeError('Selected-video frame packing requires exact source custody.');
	}
	const timing = request.timing;
	if (!timing || typeof timing !== 'object'
		|| !Number.isSafeInteger(timing.timescale) || timing.timescale < 1
		|| timing.timescale > 0x7fff_ffff || !Array.isArray(timing.frames)
		|| timing.frames.length < 1) {
		throw new TypeError('Selected-video frame packing requires bounded timing authority.');
	}
	let priorFrame = -1;
	let priorTick = -1n;
	for (const frame of timing.frames) {
		if (!frame || !Number.isSafeInteger(frame.sourceFrame) || frame.sourceFrame <= priorFrame
			|| typeof frame.presentationTick !== 'string'
			|| !/^(?:0|[1-9]\d*)$/u.test(frame.presentationTick)
			|| BigInt(frame.presentationTick) <= priorTick
			|| typeof frame.timestampSeconds !== 'number'
			|| !Number.isFinite(frame.timestampSeconds) || frame.timestampSeconds < 0) {
			throw new RangeError('Selected-video frame timing is noncanonical or unordered.');
		}
		priorFrame = frame.sourceFrame;
		priorTick = BigInt(frame.presentationTick);
	}
	return Object.freeze({ body: request.body, timing, signal: request.signal,
		assertCurrent: request.assertCurrent });
}

async function openDecoder(
	request: LocalAssistanceSelectedVideoFramePackRequest,
	create: LocalAssistanceSelectedVideoFramePackOptions['createDecoder'],
	width: number,
	height: number,
): Promise<LocalAssistanceSelectedVideoFrameDecoder> {
	const options = { signal: request.signal, width, height };
	const decoder = await (create ? create(request.body, options)
		: defaultDecoder(request.body, options, request.timing.sourceIndex));
	if (!decoder || typeof decoder.capture !== 'function' || typeof decoder.dispose !== 'function') {
		throw new TypeError('Selected-video frame packing received an invalid decoder.');
	}
	return decoder;
}

async function defaultDecoder(
	body: Blob,
	options: Readonly<{
		readonly signal: AbortSignal;
		readonly width: number;
		readonly height: number;
	}>,
	sourceIndex: VideoTimingIndex | undefined,
): Promise<LocalAssistanceSelectedVideoFrameDecoder> {
	const media = await import('../../../../video-media.js');
	const { linuxWebKitCompositorOffset } = await import('../../../../video-frame-capture-timing.ts');
	const view = sourceIndex && await qualifiedPictureView(body, sourceIndex, options.signal);
	const extractor = await media.createAudioEditorVideoFrameExtractor(view?.blob ?? body,
		view ? { ...options, timing: sourceIndex, compositorTimeOffset: linuxWebKitCompositorOffset(view.compositionShiftSeconds) } : options) as Readonly<{
		capturePixels(timestamp: number, options: Readonly<Record<string, unknown>>): Promise<Readonly<{
			readonly width: number;
			readonly height: number;
			readonly pixels: Uint8Array;
		}>>;
		dispose(): void;
	}>;
	return Object.freeze({
		async capture(request: Readonly<{ timestampSeconds: number; signal: AbortSignal }>) {
			const { width, height, pixels } = await extractor.capturePixels(request.timestampSeconds, {
				maximumWidth: options.width,
				maximumHeight: options.height,
				alpha: false, signal: request.signal,
			});
			return Object.freeze({ width, height, rgba: pixels });
		},
		dispose: () => extractor.dispose(),
	});
}

async function qualifiedPictureView(body: Blob, index: VideoTimingIndex, signal: AbortSignal) {
	if (body.type !== 'video/mp4' && body.type !== 'video/quicktime') return null;
	try {
		const { prepareQualifiedFragmentPlaybackView } = await import('../../../../video-source-monitor-fragment-view.ts');
		return await prepareQualifiedFragmentPlaybackView(body, {
			...index, presentationTick: ordinal => index.presentationTicks[ordinal],
		}, signal, { standardSampleEntry: true, programmePicture: true });
	} catch {
		signal.throwIfAborted();
		return null;
	}
}

function reviewedFrame(value: unknown): LocalAssistanceDecodedVideoFrame {
	if (!value || typeof value !== 'object') {
		throw new TypeError('Selected-video decode did not return an RGBA frame.');
	}
	const frame = value as Partial<LocalAssistanceDecodedVideoFrame>;
	const width = integer(frame.width, 1, 16_384, 'selected-video decoded width');
	const height = integer(frame.height, 1, 16_384, 'selected-video decoded height');
	if (!(frame.rgba instanceof Uint8Array) || frame.rgba.byteLength !== width * height * 4) {
		throw new RangeError('Selected-video decoded RGBA geometry is invalid.');
	}
	return Object.freeze({ width, height, rgba: frame.rgba });
}

function exactGeometry(
	frame: LocalAssistanceDecodedVideoFrame,
	width: number,
	height: number,
): Uint8Array {
	if (frame.width === width && frame.height === height) return frame.rgba.slice();
	const result = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const sourceX = Math.min(frame.width - 1,
				Math.floor((x + 0.5) * frame.width / width));
			const sourceY = Math.min(frame.height - 1,
				Math.floor((y + 0.5) * frame.height / height));
			const sourceOffset = (sourceY * frame.width + sourceX) * 4;
			result.set(frame.rgba.subarray(sourceOffset, sourceOffset + 4),
				(y * width + x) * 4);
		}
	}
	return result;
}

function assertReady(request: LocalAssistanceSelectedVideoFramePackRequest): void {
	request.signal.throwIfAborted();
	request.assertCurrent();
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}
