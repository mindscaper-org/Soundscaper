/* SPDX-License-Identifier: AGPL-3.0-only */

import { timelineLabelTrackContentHeight, type TimelineLabelRange } from './label-design-geometry.ts';
import { sameImmutableTimelineLabels, timelineLabelFontRevision } from './label-layout-preparation.ts';

export interface TimelineLabelHeightTrack {
	readonly id: string;
	readonly type?: string;
	readonly labels?: readonly TimelineLabelRange[];
}

interface RetainedHeight {
	readonly labels: readonly TimelineLabelRange[];
	readonly key: string;
	readonly height: number;
}

/** Retain one current label container per track; removed tracks and old geometry retire. */
export function createTimelineLabelTrackHeightReader() {
	let retained = new Map<string, RetainedHeight>();
	let heights = new Map<string, number>();
	return (tracks: readonly TimelineLabelHeightTrack[] | undefined, pixelsPerSecond: number, sampleRate: number, sizePt: number) => {
		const key = `${timelineLabelFontRevision()}|${pixelsPerSecond}|${sampleRate}|${sizePt}`;
		const next = new Map<string, RetainedHeight>();
		const nextHeights = new Map<string, number>();
		for (const track of tracks ?? []) {
			if (track.type !== 'label' || !track.labels) continue;
			const previous = retained.get(track.id);
			const reusable = previous && sameImmutableTimelineLabels(previous.labels, track.labels);
			const labels = reusable ? previous.labels : track.labels;
			const entry = reusable && previous.key === key ? previous
				: { labels, key, height: timelineLabelTrackContentHeight(labels, pixelsPerSecond, sampleRate, sizePt) };
			next.set(track.id, entry); nextHeights.set(track.id, entry.height);
		}
		retained = next;
		const previousEntries = [...heights];
		if (nextHeights.size !== heights.size || [...nextHeights].some(([id, height], index) => {
			const previous = previousEntries[index];
			return previous?.[0] !== id || previous[1] !== height;
		})) heights = nextHeights;
		return heights;
	};
}
