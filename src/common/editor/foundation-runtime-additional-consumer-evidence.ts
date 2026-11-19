/* SPDX-License-Identifier: AGPL-3.0-only */
import type { FoundationRuntimeConsumerEvidence } from './foundation-runtime-consumer-evidence.ts';

/** Projection evidence for audio and video previews and transcript geometry. */
export const FOUNDATION_RUNTIME_ADDITIONAL_CONSUMERS: readonly FoundationRuntimeConsumerEvidence[] = [
	{
		id: 'indexed-video-preview-picture', surface: 'preview', file: 'src/common/editor/video-source-time.ts',
		entryPoint: 'indexedUnretimedVideoFrameAtSample', inputIdentifier: 'project', projectedIdentifier: null,
		boundary: 'resolveRuntimeClipProjection',
		evidence: 'The preview resolves the authored clip before mapping the selected project sample onto the verified source picture clock.',
	},
	{
		id: 'normalization-controls-musical-target', surface: 'composition',
		file: 'src/common/editor/controller/clip-video/internal/clip-normalization-controls.ts', entryPoint: 'clipNormalizationControlProject',
		inputIdentifier: 'project', projectedIdentifier: 'targetGeometry', boundary: 'resolveRuntimeClipProjection',
		evidence: 'Normalization control-track assembly resolves the authored target placement before positioning its measured preview clip on the retained detector-clock tracks.',
	},
	{
		id: 'source-preview-controls-musical-target', surface: 'preview',
		file: 'src/common/editor/controller/clip-video/internal/clip-source-preview-controls.ts', entryPoint: 'withClipSourcePreviewControls',
		inputIdentifier: 'playbackProject', projectedIdentifier: 'targetGeometry', boundary: 'resolveRuntimeClipProjection',
		evidence: 'Source preview resolves the authored target placement before deriving the source-to-project origin and aligning retained control-track audio.',
	},
	{
		id: 'transcript-editing-runtime-geometry', surface: 'timeline',
		file: 'src/common/editor/transcript-editing.ts', entryPoint: 'transcriptEditingProject',
		inputIdentifier: 'project', projectedIdentifier: 'resolved', boundary: 'resolveRuntimeProjectProjection',
		evidence: 'Transcript editing resolves persisted clip geometry before mapping source transcript timings into timeline word positions and generation ranges.',
	},
];
