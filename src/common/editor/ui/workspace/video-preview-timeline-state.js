/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveVideoCompositionIntervals } from '../../video-timeline.js';
import { resolveVideoPreviewVisual } from './video-preview-visual.ts';

export function createVideoPreviewTimelineState(
	project, controller, missingSourceIds, failedVideoSources, renderCanvas,
	keyframeStateProvider, resolveClipPresentation, resolveTransitionWeight, timelineResolver,
) {
	const empty = {
		intervals: [], clipStateById: new Map(), maxLayerCount: 0, renderCanvas,
		keyframeStateProvider, resolveClipPresentation, resolveTransitionWeight,
	};
	if (!project) return empty;
	try {
		const options = { renderCanvas, resolveClipPresentation, resolveTransitionWeight };
		const intervals = timelineResolver ? timelineResolver.resolveCompositionIntervals(options)
			: resolveVideoCompositionIntervals(project, options);
		const clipStateById = new Map();
		for (const clip of project.clips || []) {
			if (clip?.kind !== 'video') continue;
			const visual = resolveVideoPreviewVisual(controller, clip.id, clip.sourceId);
			const sourceUrl = visual?.mediaUrl || visual?.url || null;
			clipStateById.set(clip.id, { available: Boolean(
				project.sources?.some((source) => source.id === clip.sourceId)
				&& sourceUrl && visual?.available !== false
				&& (visual?.mediaKind === 'proxy' || !missingSourceIds.has(clip.sourceId))
				&& failedVideoSources.get(clip.id) !== sourceUrl,
			) });
		}
		let maxLayerCount = 0;
		for (const interval of intervals) {
			maxLayerCount = Math.max(maxLayerCount, interval.layers?.length || 0);
		}
		return { ...empty, intervals, clipStateById, maxLayerCount };
	} catch {
		return empty;
	}
}
