/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveTimelinePlaybackScroll,
	type TimelinePlaybackFollowMode,
} from './timeline-playback-frame-loop.ts';
import { readTimelineContentScrollX, timelineDomScrollForElement } from './timeline-scroll-space.ts';

interface TimelinePlayheadFrameOptions {
	readonly playheadX: number;
	readonly follow: boolean;
	readonly mode: TimelinePlaybackFollowMode;
	readonly viewportWidth: number;
	readonly leadingInset: number;
	readonly suspended: boolean;
}

const PLAYHEAD_PROPERTY = '--timeline-playhead-x';
const PLAYHEAD_CONSUMERS = '.audio-editor-ruler-playhead,.audio-editor-playhead-boundary .playhead-cursor,.audio-editor-output-playhead';

/** Read the follow viewport before publishing position to its non-inheriting paint owners. */
export function projectTimelinePlaybackFrame(
	root: HTMLElement | null,
	scroll: HTMLElement | null,
	options: TimelinePlayheadFrameOptions,
): Readonly<{ readonly suspended: boolean; readonly targetDomScrollX: number | null }> {
	let suspended = options.suspended;
	let targetDomScrollX: number | null = null;
	if (options.follow && scroll) {
		const scrollLeft = options.mode === 'none' ? 0 : scroll.scrollLeft;
		const scrollX = options.mode === 'none' ? 0
			: readTimelineContentScrollX({ scrollLeft, dataset: scroll.dataset });
		const resolution = resolveTimelinePlaybackScroll({ ...options, scrollX });
		suspended = resolution.suspended;
		if (resolution.targetScrollX !== null) {
			const nextScroll = timelineDomScrollForElement(scroll, resolution.targetScrollX);
			if (!(Math.abs(scrollLeft - nextScroll) <= 1)) targetDomScrollX = nextScroll;
		}
	}
	if (root) {
		const value = `${options.playheadX}px`;
		// Re-read the small owner list so paused rows/output docks mounted by a
		// later React commit receive the current position without retained DOM.
		for (const element of root.querySelectorAll<HTMLElement>(PLAYHEAD_CONSUMERS)) {
			if (element.style.getPropertyValue(PLAYHEAD_PROPERTY) !== value) {
				element.style.setProperty(PLAYHEAD_PROPERTY, value);
			}
		}
		// Preserve the root's diagnostic coordinate without inheriting it through
		// every clip, control and canvas on each animation frame.
		if (root.style.getPropertyValue(PLAYHEAD_PROPERTY) !== value) root.style.setProperty(PLAYHEAD_PROPERTY, value);
	}
	return { suspended, targetDomScrollX };
}
