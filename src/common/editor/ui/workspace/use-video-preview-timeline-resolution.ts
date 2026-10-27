/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo } from 'react';
import { createVideoTimelineResolver } from '../../video-timeline.js';
import { isVideoKeyframePreviewStateError } from '../../video-keyframe-preview-state.ts';

interface Request {
	readonly project: unknown;
	readonly positionFrame: number;
	readonly renderCanvas: unknown;
	readonly resolveClipRenderState: unknown;
	readonly resolveClipPresentation: unknown;
	readonly resolveTransitionWeight: unknown;
}

export function useVideoPreviewTimelineResolution({ project, positionFrame, renderCanvas,
	resolveClipRenderState, resolveClipPresentation, resolveTransitionWeight }: Request) {
	const timelineResolver = useMemo(() => {
		try { return project ? createVideoTimelineResolver(project) : null; } catch { return null; }
	}, [project]);
	const layerResolution = useMemo(() => {
		if (!timelineResolver) return { layers: [], keyframeFailed: false };
		try {
			return { layers: timelineResolver.resolveActiveVideoLayers(positionFrame, {
				renderCanvas, resolveClipRenderState, resolveClipPresentation, resolveTransitionWeight,
			}), keyframeFailed: false };
		} catch (error) {
			return { layers: [], keyframeFailed: isVideoKeyframePreviewStateError(error) };
		}
	}, [positionFrame, timelineResolver, renderCanvas, resolveClipPresentation, resolveClipRenderState, resolveTransitionWeight]);
	return { timelineResolver, layerResolution };
}
