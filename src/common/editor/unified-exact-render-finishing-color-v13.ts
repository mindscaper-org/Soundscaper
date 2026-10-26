/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareManagedSdrGradeStackV1, type ParsedCubeLutV1 } from './video-color-management-v27.ts';
import { applyPreparedManagedSdrByteFrameV1 } from './video-color-byte-encoding.ts';
import { gradeUnifiedExactLinearSourceFrame } from './unified-exact-linear-source-frame.ts';
import type { UnifiedExactRenderRgbaFrameV13 } from './unified-exact-render-finishing-consumers-v13.ts';
import type { UnifiedExactRenderFinishingNode, UnifiedExactRenderPlanSource } from './unified-exact-render-plan.ts';
import type { VideoVisualPresentationV1 } from './video-visual-presentation-v27.ts';

export function managedColor(
	finishing: UnifiedExactRenderFinishingNode,
	source: UnifiedExactRenderPlanSource,
	presentations: readonly VideoVisualPresentationV1[],
	frame: UnifiedExactRenderRgbaFrameV13,
	lutBodies: ReadonlyMap<string, ParsedCubeLutV1> | undefined,
	outputEncoding: 'encoded-output' | 'linear-rec709-d65',
	frameEncoding: 'source-encoded' | 'canvas-srgb',
	signal?: AbortSignal,
): UnifiedExactRenderRgbaFrameV13 {
	const prepared = preparedColor(finishing, source, presentations, lutBodies, frameEncoding);
	const pixels = applyPreparedManagedSdrByteFrameV1(prepared, frame,
		outputEncoding === 'linear-rec709-d65' ? outputEncoding : finishing.colorContext.outputSpace, signal);
	return Object.freeze({ width: frame.width, height: frame.height, pixels });
}

export function managedLinearColor(
	finishing: UnifiedExactRenderFinishingNode, source: UnifiedExactRenderPlanSource,
	presentations: readonly VideoVisualPresentationV1[], frame: UnifiedExactRenderRgbaFrameV13,
	lutBodies: ReadonlyMap<string, ParsedCubeLutV1> | undefined,
	frameEncoding: 'source-encoded' | 'canvas-srgb', signal?: AbortSignal,
) {
	return gradeUnifiedExactLinearSourceFrame(preparedColor(finishing, source, presentations, lutBodies, frameEncoding), frame, signal);
}

function preparedColor(
	finishing: UnifiedExactRenderFinishingNode, source: UnifiedExactRenderPlanSource,
	presentations: readonly VideoVisualPresentationV1[], lutBodies: ReadonlyMap<string, ParsedCubeLutV1> | undefined,
	frameEncoding: 'source-encoded' | 'canvas-srgb',
) {
	const interpretation = finishing.sourceInterpretations.find(({ sourceId }) => sourceId === source.sourceId);
	if (!interpretation) throw new ReferenceError('The V13 source color interpretation is unavailable.');
	const grades = presentations.flatMap(({ grade }) => grade === null ? [] : [grade]);
	const luts = grades.map(({ lut }) => lut === null ? undefined : lutBodies?.get(lut.sha256));
	// The interpretation and the grade stack are the frame's, not the pixel's:
	// admitting and normalizing them once here is what keeps a preview frame
	// off the main thread for seconds at a time.
	return prepareManagedSdrGradeStackV1({
		decoding: frameEncoding === 'canvas-srgb' ? 'canvas-readback' : 'file',
		interpretation, grades, luts,
	});
}
