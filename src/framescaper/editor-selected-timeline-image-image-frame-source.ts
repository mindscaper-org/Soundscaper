/* SPDX-License-Identifier: AGPL-3.0-only */

import { sequenceFrameAtSample } from '../common/editor/sequence-frame-navigation.ts';
import { resolveVideoCanvasMaterializationSize, type VideoCanvasFit } from '../common/editor/video-canvas-fit.ts';
import { resizeVideoRgbaNearest } from '../common/editor/video-rgba-nearest-resize.ts';
import type { BlobLike } from '../common/editor/storage/media-records.ts';
import {
	openFramescaperImageFramePackSnapshotV1,
	type FramescaperImageFramePackReaderV1,
	type FramescaperImageFramePackSnapshotReaderV1,
} from '../common/editor/timeline-image-frame-pack-v1.ts';
import {
	createFramescaperImageTimelineTickMapperV1,
	normalizeFramescaperImageClipV1,
	normalizeFramescaperImageSourceV1,
	type FramescaperImageClipV1,
	type FramescaperImageSourceV1,
} from '../common/editor/timeline-image-model.ts';

export const FRAMESCAPER_IMAGE_PREVIEW_MAXIMUM_FITTED_PIXELS_TIMELINE_IMAGE = 33_554_432;

export interface FramescaperStoredImageFrameTimelineImage {
	readonly sourceTicks: bigint;
	readonly frameIndex: number;
	readonly pixels: Uint8Array<ArrayBuffer>;
}

/** Narrow stored-body port whose arrayBuffer result is transferred into timelineImage reader custody. */
export interface FramescaperStoredImageAssetStoreTimelineImage {
	loadMediaAsset(
		storageKey: string,
		options?: Readonly<{ readonly signal?: AbortSignal }>,
	): PromiseLike<BlobLike | null>;
}

/** Own one body snapshot and authenticate its complete frame-pack graph before use. */
export async function openFramescaperStoredImageFramePackTimelineImage(
	store: FramescaperStoredImageAssetStoreTimelineImage,
	sourceValue: unknown,
	signal?: AbortSignal,
	admitResidentMetadata?: (byteLength: number) => void,
): Promise<FramescaperImageFramePackSnapshotReaderV1> {
	if (!store || typeof store.loadMediaAsset !== 'function') {
		throw new TypeError('timelineImage image preview requires an AudioEditorProjectStore.');
	}
	const source = normalizeFramescaperImageSourceV1(sourceValue);
	throwIfAborted(signal);
	const body = await store.loadMediaAsset(source.storageKey, { ...(signal ? { signal } : {}) });
	throwIfAborted(signal);
	if (!body || body.size !== source.assetByteLength
		|| typeof body.slice !== 'function' || typeof body.arrayBuffer !== 'function') {
		throw new Error(`timelineImage image frame pack ${source.id} is unavailable or has the wrong byte length.`);
	}
	const loaded = await body.arrayBuffer();
	throwIfAborted(signal);
	if (!(loaded instanceof ArrayBuffer) || loaded.byteLength !== source.assetByteLength) {
		throw new Error(`timelineImage image frame pack ${source.id} changed while its body was snapshotted.`);
	}
	return openFramescaperImageFramePackSnapshotV1(source, loaded, signal, admitResidentMetadata);
}

/** Resolve one runtime sample through the exact sequence grid and packed tick table. */
export async function readFramescaperStoredImageFrameAtSampleTimelineImage(
	reader: FramescaperImageFramePackReaderV1,
	clipValue: unknown,
	timelineSample: number,
	sequenceRate: Readonly<{ readonly num: number; readonly den: number }>,
	sampleRate: number,
	signal?: AbortSignal,
): Promise<FramescaperStoredImageFrameTimelineImage> {
	const address = mapFramescaperImageFrameAtSampleTimelineImage(
		reader, clipValue, timelineSample, sequenceRate, sampleRate,
	);
	return Object.freeze({
		...address,
		pixels: await reader.readFrame(address.frameIndex, signal) as Uint8Array<ArrayBuffer>,
	});
}

/** Synchronous address resolution against authenticated preview timings. */
export function mapFramescaperImageFrameAtSampleTimelineImage(
	reader: FramescaperImageFramePackReaderV1,
	clipValue: unknown,
	timelineSample: number,
	sequenceRate: Readonly<{ readonly num: number; readonly den: number }>,
	sampleRate: number,
): Readonly<{ readonly sourceTicks: bigint; readonly frameIndex: number }> {
	const clip = normalizeFramescaperImageClipV1(clipValue);
	const sequenceFrame = sequenceFrameAtSample(timelineSample, sequenceRate, sampleRate);
	const sourceTicks = createFramescaperImageTimelineTickMapperV1(clip, sequenceRate)(sequenceFrame);
	return Object.freeze({ sourceTicks, frameIndex: reader.frameIndexAtTicks(sourceTicks) });
}

/** Deterministic nearest-neighbour RGBA resize shared by bin and filmstrip pictures. */
export function scaleFramescaperImageRgbaTimelineImage(
	pixelsValue: Uint8Array,
	sourceWidthValue: number,
	sourceHeightValue: number,
	targetWidthValue: number,
	targetHeightValue: number,
	signal?: AbortSignal,
): Uint8Array<ArrayBuffer> {
	const sourceWidth = dimension(sourceWidthValue, 'timelineImage image source width');
	const sourceHeight = dimension(sourceHeightValue, 'timelineImage image source height');
	const targetWidth = dimension(targetWidthValue, 'timelineImage image target width');
	const targetHeight = dimension(targetHeightValue, 'timelineImage image target height');
	if (targetWidth * targetHeight > FRAMESCAPER_IMAGE_PREVIEW_MAXIMUM_FITTED_PIXELS_TIMELINE_IMAGE) {
		throw new RangeError('A timelineImage image preview frame may contain at most 33554432 pixels.');
	}
	if (!(pixelsValue instanceof Uint8Array)
		|| pixelsValue.byteLength !== sourceWidth * sourceHeight * 4) {
		throw new RangeError('timelineImage image RGBA bytes do not match their canonical dimensions.');
	}
	throwIfAborted(signal);
	if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
		return pixelsValue.slice() as Uint8Array<ArrayBuffer>;
	}
	return resizeVideoRgbaNearest({ pixels: pixelsValue, width: sourceWidth, height: sourceHeight },
		targetWidth, targetHeight, 0, () => { throwIfAborted(signal); });
}

export function fitFramescaperImagePreviewSizeTimelineImage(
	source: FramescaperImageSourceV1,
	maximumWidthValue: number,
	maximumHeightValue: number,
	fit: VideoCanvasFit = 'contain',
): Readonly<{ readonly width: number; readonly height: number }> {
	const canonical = normalizeFramescaperImageSourceV1(source).canonical;
	const maximumWidth = dimension(maximumWidthValue, 'timelineImage image preview width');
	const maximumHeight = dimension(maximumHeightValue, 'timelineImage image preview height');
	return resolveVideoCanvasMaterializationSize(fit, maximumWidth, maximumHeight, canonical.width, canonical.height);
}

export function framescaperImageSourceForClipTimelineImage(
	sources: readonly unknown[],
	clipValue: unknown,
): FramescaperImageSourceV1 {
	const clip = normalizeFramescaperImageClipV1(clipValue);
	const source = sources.find((candidate) => (
		candidate && typeof candidate === 'object'
		&& !Array.isArray(candidate)
		&& (candidate as Readonly<Record<string, unknown>>).id === clip.sourceId
	));
	if (source === undefined) throw new ReferenceError(`timelineImage image source ${clip.sourceId} is unavailable.`);
	const normalized = normalizeFramescaperImageSourceV1(source);
	if (normalized.id !== clip.sourceId) throw new ReferenceError('timelineImage image clip changed source authority.');
	return normalized;
}

export function throwIfFramescaperImagePreviewAbortedTimelineImage(signal?: AbortSignal): void {
	throwIfAborted(signal);
}

function dimension(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 65_536) {
		throw new RangeError(`${name} must be a positive bounded dimension.`);
	}
	return Number(value);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw signal.reason ?? new DOMException('The timelineImage image preview was aborted.', 'AbortError');
	}
}

export type {
	FramescaperImageClipV1,
	FramescaperImageFramePackReaderV1,
	FramescaperImageSourceV1,
};
