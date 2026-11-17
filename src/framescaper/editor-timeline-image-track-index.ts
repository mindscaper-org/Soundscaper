/* SPDX-License-Identifier: AGPL-3.0-only */

import { projectTrackFolderMediaStateV12 } from '../common/editor/track-folder-media-runtime.ts';
import { createVisibleVideoTrackPredicate } from '../common/editor/video-track-visibility.js';
import type { FramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';

type ImageTrackPlacement = Readonly<{ trackId: string; trackIndex: number }>;

export function indexVisibleFramescaperImageTracks(
	project: FramescaperProjectTimelineImage,
	sequence: FramescaperProjectTimelineImage['sequences'][number],
): ReadonlyMap<string, ImageTrackPlacement | null> {
	const trackIndexes = new Map<string, number>();
	for (const [index, id] of sequence.trackIds.entries()) {
		if (!trackIndexes.has(id)) trackIndexes.set(id, index);
	}
	const tracks = projectTrackFolderMediaStateV12(project).tracks
		.filter((track) => track.type === 'video' && trackIndexes.has(track.id));
	const visible = createVisibleVideoTrackPredicate(tracks);
	const clipTracks = new Map<string, ImageTrackPlacement | null>();
	for (const track of tracks) {
		const placement = visible(track) ? { trackId: track.id, trackIndex: trackIndexes.get(track.id)! } : null;
		for (const clipId of track.clipIds) {
			if (!clipTracks.has(clipId)) clipTracks.set(clipId, placement);
		}
	}
	return clipTracks;
}
