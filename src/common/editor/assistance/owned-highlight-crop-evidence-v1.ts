/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic clipping of accepted Reframe paths into exact Highlight ranges. */

import { reviewAssistanceAcceptedReframeDerivativeV1, type AssistanceAcceptedReframeDerivativeV1 } from './reframe-derivative-v1.ts';
import type { AssistanceOwnedHighlightCropKeyframeV1 } from
	'./owned-video-highlight-transform-types-v1.ts';
import type { ReviewedAssistanceSourceTimeRowsV1 } from './source-time-rows-v1.ts';
import {
	interpolateAssistanceReframeCropV1,
	planAssistanceReframePathV1,
} from './reframe-planner-v1.ts';

interface VideoGeometry {
	readonly sourceId: string;
	readonly timescale: number;
	readonly sourceSize: Readonly<{ width: number; height: number }>;
	readonly selectionStartFrame: number;
	readonly selectionEndFrame: number;
	readonly authority: ReviewedAssistanceSourceTimeRowsV1;
}

export function createOwnedHighlightCropKeyframesV1(request: Readonly<{
	readonly video: VideoGeometry & Readonly<{
		readonly reframeEvidence: AssistanceAcceptedReframeDerivativeV1 | null;
	}>;
	readonly sourceStartFrame: number;
	readonly sourceEndFrame: number;
	readonly targetAspect: Readonly<{ width: number; height: number }>;
}>): readonly AssistanceOwnedHighlightCropKeyframeV1[] {
	return prepareOwnedHighlightCropKeyframesV1(request.video, request.targetAspect)(
		request.sourceStartFrame, request.sourceEndFrame);
}

/** One operation owns the detached reviewed path; each window visits only its interval. */
export function prepareOwnedHighlightCropKeyframesV1(
	video: Readonly<{ sourceSize: Readonly<{ width: number; height: number }>;
		reframeEvidence: AssistanceAcceptedReframeDerivativeV1 | null }>,
	targetAspectValue: Readonly<{ width: number; height: number }>,
): (sourceStartFrame: number, sourceEndFrame: number) => readonly AssistanceOwnedHighlightCropKeyframeV1[] {
	const targetAspect = Object.freeze({ ...targetAspectValue });
	const sourceSize = Object.freeze({ ...video.sourceSize });
	const evidence = video.reframeEvidence === null ? null
		: reviewAssistanceAcceptedReframeDerivativeV1(video.reframeEvidence);
	if (evidence && (evidence.result.path.targetAspect.width !== targetAspect.width
		|| evidence.result.path.targetAspect.height !== targetAspect.height)) {
		throw new RangeError('Accepted Reframe evidence disagrees with Highlight target aspect.');
	}
	const path = evidence?.result.path.keyframes ?? [];
	const lower = (target: number): number => {
		let first = 0, end = path.length;
		while (first < end) {
			const middle = first + Math.floor((end - first) / 2);
			if (path[middle]!.sourceFrame < target) first = middle + 1;
			else end = middle;
		}
		return first;
	};
	const boundary = (sourceFrame: number): AssistanceOwnedHighlightCropKeyframeV1 => {
		const index = lower(sourceFrame), exact = path[index];
		if (exact?.sourceFrame === sourceFrame) return exact;
		const left = path[Math.max(0, index - 1)]!, right = path[Math.min(index, path.length - 1)]!;
		const adjacent = left === right ? [left] : [left, right];
		return Object.freeze({ sourceFrame, authority: 'center' as const, trackIds: Object.freeze([]),
			crop: interpolateAssistanceReframeCropV1(adjacent.map((key) => ({ schemaVersion: 1, ...key })), sourceFrame) });
	};
	return (sourceStartFrame, sourceEndFrame) => {
		if (!Number.isSafeInteger(sourceStartFrame) || !Number.isSafeInteger(sourceEndFrame)
			|| sourceEndFrame - sourceStartFrame < 2) {
			throw new RangeError('A highlight proposal needs two exact source crop anchors.');
		}
		if (evidence === null) return Object.freeze(planAssistanceReframePathV1({ sourceSize,
			targetAspect, samples: [
				{ sourceFrame: sourceStartFrame, subjects: [], saliency: null },
				{ sourceFrame: sourceEndFrame - 1, subjects: [], saliency: null },
			] }).map(({ schemaVersion: _, ...keyframe }) => keyframe));
		const endFrame = sourceEndFrame - 1;
		const begin = lower(sourceStartFrame);
		const first = path[begin]?.sourceFrame === sourceStartFrame ? begin + 1 : begin;
		const keyframes = Object.freeze([boundary(sourceStartFrame),
			...path.slice(first, lower(endFrame)), boundary(endFrame)]);
		assertOwnedHighlightCropAspectV1(keyframes, sourceSize, targetAspect);
		return keyframes;
	};
}

export function assertOwnedHighlightReframeVideoAuthorityV1(
	evidence: AssistanceAcceptedReframeDerivativeV1,
	video: VideoGeometry,
): void {
	const range = evidence.authority.sourceRange;
	if (range.sourceId !== video.sourceId
		|| evidence.result.authority.width !== video.sourceSize.width
		|| evidence.result.authority.height !== video.sourceSize.height
		|| evidence.result.authority.timescale !== video.timescale
		|| video.authority.first.sourceFrame !== range.sourceStartFrame
		|| video.authority.last.sourceFrame !== range.sourceEndFrame
		|| video.authority.first.timelineFrame !== video.selectionStartFrame
		|| video.authority.last.timelineFrame !== video.selectionEndFrame) {
		throw new RangeError('Accepted Reframe evidence disagrees with Highlight video geometry.');
	}
	if (evidence.result.authority.frames.some(({ sourceFrame, presentationTick }) =>
		sourcePresentationTick(video.authority, sourceFrame) !== presentationTick)) {
		throw new RangeError('Accepted Reframe evidence disagrees with Highlight source time.');
	}
}

function sourcePresentationTick(
	authority: ReviewedAssistanceSourceTimeRowsV1,
	sourceFrame: number,
): string | undefined {
	const index = authority.firstAtOrAfterSource(sourceFrame);
	return index < authority.rowCount && authority.row(index).sourceFrame === sourceFrame
		? authority.row(index).presentationTick : undefined;
}

export function assertOwnedHighlightCropAspectV1(
	keyframes: readonly AssistanceOwnedHighlightCropKeyframeV1[],
	sourceSize: Readonly<{ width: number; height: number }>,
	targetAspect: Readonly<{ width: number; height: number }>,
): void {
	const expected = targetAspect.width / targetAspect.height;
	for (const { crop } of keyframes) {
		const width = sourceSize.width * (1 - crop.left - crop.right);
		const height = sourceSize.height * (1 - crop.top - crop.bottom);
		if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0
			|| Math.abs(width / height - expected) > Math.max(1, expected) * 1e-8) {
			throw new RangeError('Highlight crop evidence disagrees with authenticated target aspect.');
		}
	}
}
