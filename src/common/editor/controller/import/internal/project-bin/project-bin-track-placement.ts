/* SPDX-License-Identifier: AGPL-3.0-only */
import { isFramescaperSequenceProjectSchema } from '../../../../project-schema-version.ts';
import { trackHierarchyPlacement } from '../../../../track-hierarchy-placement.ts';

/** New Bin lanes follow the focused track's owning sequence and folder. */
export function projectBinTrackPlacement(project: object, focusedTrackId: string | null, offset = 1) {
	if (!focusedTrackId) return {};
	const framescaper = isFramescaperSequenceProjectSchema(project);
	const placement = trackHierarchyPlacement(project, focusedTrackId, offset, !framescaper);
	// Soundscaper retains implicit primary placement; explicit secondary track
	// creation belongs to the product that owns nested-sequence authoring.
	return placement.sequenceId && !framescaper ? {} : placement;
}
