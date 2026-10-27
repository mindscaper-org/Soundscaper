/* SPDX-License-Identifier: AGPL-3.0-only */

interface TrackSequence {
	readonly id: string;
	readonly trackIds?: readonly string[];
	readonly trackNodes?: readonly Readonly<{ id: string; parentFolderId?: string | null }>[];
}

export interface SequenceTrackPlacement {
	readonly sequenceId: string;
	readonly parentFolderId: string | null;
}

/** First sequence and first node win, matching a direct hierarchy lookup. */
export function indexSequenceTrackPlacements(sequences: readonly TrackSequence[]): ReadonlyMap<string, SequenceTrackPlacement> {
	const locations = new Map<string, SequenceTrackPlacement>();
	for (const sequence of sequences) {
		for (const node of sequence.trackNodes ?? []) if (!locations.has(node.id)) {
			locations.set(node.id, { sequenceId: sequence.id, parentFolderId: node.parentFolderId ?? null });
		}
		for (const id of sequence.trackIds ?? []) if (!locations.has(id)) {
			locations.set(id, { sequenceId: sequence.id, parentFolderId: null });
		}
	}
	return locations;
}
