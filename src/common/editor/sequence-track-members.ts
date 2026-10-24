/* SPDX-License-Identifier: AGPL-3.0-only */

interface SequenceTrackProject {
	readonly sequences?: readonly Readonly<{
		readonly trackIds?: readonly string[];
		readonly trackNodes?: readonly Readonly<{ readonly kind: string; readonly id: string }>[];
	}>[];
}

/** An implicit peer operation must stay in the source track's sequence. */
export function sequenceTrackMembers(project: object | null | undefined, trackId: string | null | undefined): ReadonlySet<string> | null {
	if (!trackId) return null;
	for (const sequence of (project as SequenceTrackProject | null | undefined)?.sequences ?? []) {
		if (sequence.trackNodes) {
			if (!sequence.trackNodes.some(node => node.kind === 'track' && node.id === trackId)) continue;
			const members = new Set<string>();
			for (const node of sequence.trackNodes) if (node.kind === 'track') members.add(node.id);
			return members;
		}
		if (sequence.trackIds?.includes(trackId)) return new Set(sequence.trackIds);
	}
	return null;
}
