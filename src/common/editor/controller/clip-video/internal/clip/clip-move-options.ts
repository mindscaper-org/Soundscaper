/* SPDX-License-Identifier: AGPL-3.0-only */

import { clipSelectionMembership } from './clip-selection-membership.ts';
import type { ClipTransformProject, ClipTransformSelection } from './clip-domain-types.ts';

export interface ClipMoveOptions {
	readonly overwrite?: boolean;
	/** Copy the captured clips through the native duplicate carrier at the drag destination. */
	readonly duplicate?: boolean;
	readonly allOnTrack?: boolean;
	readonly preserveTime?: boolean;
	/** Preserve an explicitly aligned physical boundary instead of quantizing it to the time grid. */
	readonly exactFrame?: boolean;
	readonly clipIds?: readonly string[];
}

/** A whole-track gesture replaces unrelated clip picks with its actual participants. */
export function clipMoveSelection(
	project: ClipTransformProject,
	clipIds: readonly string[],
	options: ClipMoveOptions,
): ClipTransformSelection | null | undefined {
	if ((!options.allOnTrack && !options.clipIds) || !project.selection) return project.selection;
	return {
		...project.selection,
		clipIds: [...clipIds],
		trackIds: selectedTrackIds(project, clipIds),
	};
}

function selectedTrackIds(project: ClipTransformProject, clipIds: readonly string[]): string[] {
	const tracks = project.tracks;
	const selected = clipSelectionMembership(tracks, clipIds);
	return tracks.filter(track => track.clipIds?.some(id => selected ? selected.has(id) : clipIds.includes(id)))
		.map(track => track.id);
}
