/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic built-in motion analysis and authenticated transient bodies. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
	normalizeVideoMotionAnalysisReferenceV1,
	normalizeVideoProcessorStackV1,
	type VideoMotionAnalysisReferenceV1,
	type VideoProcessorStackV1,
	type VideoTrackingProcessorV1,
} from './video-motion-model-v27.ts';
import {
	detectShiTomasiFeaturesV1,
	estimateSimilarityRansacV1,
	trackPyramidalLucasKanadeV1,
	VIDEO_MOTION_MAXIMUM_RANSAC_MATCHES_V1,
	type GrayVideoFrameV1,
	type VideoPointMatchV1,
	type VideoSimilarityTransformV1,
} from './video-motion-processing-v27.ts';

import {
	encodeVideoMotionAnalysisBodyV1 as encodedBody,
	normalizeVideoMotionAnalysisBodyV1 as normalizeBody,
	videoMotionSettingsSha256V1,
	type VideoMotionAnalysisBodyV1,
	type VideoMotionAnalysisTransformV1,
} from './video-motion-analysis-body-v1.ts';

export {
	requireVideoMotionAnalysisBodyV1,
	videoMotionSettingsSha256V1,
	type VideoMotionAnalysisBodyV1,
	type VideoMotionAnalysisTransformV1,
} from './video-motion-analysis-body-v1.ts';

export interface VideoMotionAnalysisResultV1 {
	readonly reference: VideoMotionAnalysisReferenceV1;
	readonly body: VideoMotionAnalysisBodyV1;
	readonly bytes: Uint8Array<ArrayBuffer>;
}

export interface VideoMotionAnalysisProgressV1 {
	readonly phase: 'tracking';
	readonly completed: number;
	readonly total: number;
}

export interface VideoMotionAnalysisRequestV1 {
	readonly analysisId: string;
	readonly inputSha256: string;
	readonly processorStack: unknown;
	readonly frames: readonly Readonly<{
		readonly frameNumber: number;
		readonly frame: GrayVideoFrameV1;
	}>[];
	readonly signal?: AbortSignal;
	readonly onProgress?: (progress: VideoMotionAnalysisProgressV1) => void;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAXIMUM_ANALYSIS_FRAMES = 1_000_000;

export async function analyzeVideoMotionV1(
	request: Readonly<VideoMotionAnalysisRequestV1>,
): Promise<VideoMotionAnalysisResultV1> {
	throwIfAborted(request?.signal);
	const analysisId = stableId(request?.analysisId, 'motion analysis ID');
	const inputSha256 = digest(request?.inputSha256, 'motion analysis input digest');
	const stack = normalizeVideoProcessorStackV1(request?.processorStack);
	const tracking = trackingProcessor(stack);
	const frames = analysisFrames(request?.frames);
	const settingsSha256 = videoMotionSettingsSha256V1(stack);
	const transforms: VideoMotionAnalysisTransformV1[] = [];
	const total = frames.length - 1;
	for (let index = 1; index < frames.length; index += 1) {
		throwIfAborted(request.signal);
		const previous = frames[index - 1]!;
		const current = frames[index]!;
		transforms.push(Object.freeze({
			frameNumber: current.frameNumber,
			transform: analyzePair(previous.frame, current.frame, tracking),
		}));
		request.onProgress?.(Object.freeze({ phase: 'tracking', completed: index, total }));
		// Let cancellation and UI progress run between expensive frame pairs.
		await yieldToHostTask();
	}
	throwIfAborted(request.signal);
	const body = normalizeBody({
		schemaVersion: 1,
		analysisId,
		sourceId: stack.sourceId,
		processorStackId: stack.id,
		inputSha256,
		settingsSha256,
		analysisWidth: frames[0]!.frame.width,
		analysisHeight: frames[0]!.frame.height,
		startFrame: frames[0]!.frameNumber,
		endFrame: frames[frames.length - 1]!.frameNumber + 1,
		transforms,
	});
	const bytes = encodedBody(body);
	const bodySha256 = bytesToHex(sha256(bytes));
	const reference = normalizeVideoMotionAnalysisReferenceV1({
		schemaVersion: 1,
		id: analysisId,
		sourceId: stack.sourceId,
		processorStackId: stack.id,
		inputSha256,
		settingsSha256,
		storageKey: `motion-sha256:${bodySha256}`,
		sha256: bodySha256,
		byteLength: bytes.byteLength,
		startFrame: body.startFrame,
		endFrame: body.endFrame,
	});
	return Object.freeze({ reference, body, bytes });
}

function analyzePair(
	previous: GrayVideoFrameV1,
	current: GrayVideoFrameV1,
	tracking: VideoTrackingProcessorV1,
): VideoSimilarityTransformV1 {
	const features = detectShiTomasiFeaturesV1(previous, tracking);
	const tracks = trackPyramidalLucasKanadeV1(previous, current, features, {
		windowRadius: tracking.windowRadius,
		pyramidLevels: tracking.pyramidLevels,
		maximumIterations: 24,
		epsilon: 1e-4,
	});
	const matches: VideoPointMatchV1[] = tracks.flatMap((track) => (
		track.status === 'tracked' && Number.isFinite(track.error)
			? [Object.freeze({
				source: track.source,
				target: track.target,
				confidence: Math.max(Number.EPSILON, Math.min(1, 1 / (1 + track.error))),
			})]
			: []
	));
	if (matches.length < 2) return identityTransform();
	const selected = matches.length <= VIDEO_MOTION_MAXIMUM_RANSAC_MATCHES_V1
		? matches
		: matches.slice().sort(compareMotionMatch).slice(0, VIDEO_MOTION_MAXIMUM_RANSAC_MATCHES_V1);
	try {
		return estimateSimilarityRansacV1(selected, {
			inlierThreshold: Math.max(0.5, tracking.minimumDistance / 2),
			minimumInliers: Math.min(4, selected.length),
		});
	} catch (error) {
		if (error instanceof RangeError && /consensus|degenerate/iu.test(error.message)) {
			return identityTransform();
		}
		throw error;
	}
}

function compareMotionMatch(left: VideoPointMatchV1, right: VideoPointMatchV1): number {
	return right.confidence - left.confidence
		|| left.source.y - right.source.y || left.source.x - right.source.x
		|| left.target.y - right.target.y || left.target.x - right.target.x;
}

function trackingProcessor(stack: VideoProcessorStackV1): VideoTrackingProcessorV1 {
	const processors = stack.processors.filter((processor): processor is VideoTrackingProcessorV1 => (
		processor.kind === 'tracking' && processor.enabled
	));
	if (processors.length !== 1) {
		throw new RangeError('Built-in motion analysis requires exactly one enabled tracking processor.');
	}
	return processors[0]!;
}

function analysisFrames(value: unknown): readonly Readonly<{
	readonly frameNumber: number;
	readonly frame: GrayVideoFrameV1;
}>[] {
	if (!Array.isArray(value) || value.length < 2 || value.length > MAXIMUM_ANALYSIS_FRAMES) {
		throw new RangeError('Motion analysis requires a bounded sequence of at least two frames.');
	}
	let width = 0;
	let height = 0;
	return Object.freeze(value.map((item, index) => {
		if (!item || typeof item !== 'object') throw new TypeError('A motion analysis frame must be an object.');
		const candidate = item as Readonly<{ frameNumber?: unknown; frame?: unknown }>;
		const frameNumber = nonNegativeInteger(candidate.frameNumber, 'motion analysis frame number');
		const frame = candidate.frame;
		if (!frame || typeof frame !== 'object') throw new TypeError('A motion analysis gray frame is required.');
		const checked = frame as GrayVideoFrameV1;
		if (index === 0) { width = checked.width; height = checked.height; }
		if (checked.width !== width || checked.height !== height) {
			throw new RangeError('Motion analysis frame dimensions must remain constant.');
		}
		if (index > 0 && frameNumber !== Number((value[index - 1] as { frameNumber?: unknown }).frameNumber) + 1) {
			throw new RangeError('Motion analysis frame numbers must be contiguous.');
		}
		return Object.freeze({ frameNumber, frame: checked });
	}));
}

function identityTransform(): VideoSimilarityTransformV1 {
	return Object.freeze({
		scale: 1, rotationRadians: 0, translateX: 0, translateY: 0,
		inlierCount: 0, meanError: 0,
	});
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${name} must be a stable ID.`);
	return value;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${name} must be lowercase SHA-256.`);
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be non-negative.`);
	return Number(value);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason instanceof Error) throw signal.reason;
	throw new DOMException('The motion analysis was aborted.', 'AbortError');
}

async function yieldToHostTask(): Promise<void> {
	const scheduler = (globalThis as typeof globalThis & {
		readonly scheduler?: Readonly<{ yield?: () => Promise<void> }>;
	}).scheduler;
	if (typeof scheduler?.yield === 'function') {
		await scheduler.yield();
		return;
	}
	await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
}
