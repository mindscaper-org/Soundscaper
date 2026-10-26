/* SPDX-License-Identifier: AGPL-3.0-only */

import { isSelectedFramescaperProjectSchema } from '../../../project-schema-version.ts';
import { trackHierarchyPlacement } from '../../../track-hierarchy-placement.ts';
import { freezeProjectImportOptions, type NormalizedProjectImportOptions } from './project-import-options.ts';

/** Every extra file stays beside the batch's original timeline track. */
export function importFilePlacement(
	project: Readonly<{ tracks: readonly Readonly<{ id: string }>[] }>,
	options: Readonly<NormalizedProjectImportOptions>,
	fileIndex: number,
): Readonly<NormalizedProjectImportOptions> {
	if (options.destination !== 'timeline' || !options.trackId || fileIndex === 0) return options;
	const targetTrackIndex = project.tracks.findIndex(({ id }) => id === options.trackId);
	const placement = trackHierarchyPlacement(project, options.trackId, fileIndex, !isSelectedFramescaperProjectSchema(project));
	return freezeProjectImportOptions({
		...options, trackId: null,
		trackIndex: targetTrackIndex < 0 ? undefined : targetTrackIndex + fileIndex,
		...(Object.keys(placement).length ? { trackPlacement: placement } : {}),
	}, Boolean(options.timelineStartExplicit));
}
