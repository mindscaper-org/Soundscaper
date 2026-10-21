/* SPDX-License-Identifier: AGPL-3.0-only */

interface SequenceTrackProject {
	readonly sequences?: readonly Readonly<{
		readonly trackIds?: readonly string[];
		readonly trackNodes?: readonly Readonly<{ readonly kind: string; readonly id: string }>[];
	}>[];
}

/** An implicit peer operation must stay in the source track's sequence. */
export function sequenceTrackMembers(project: object | null | undefined, trackId: string | null | undefined): ReadonlySet<string> | null {
	for (const sequence of (project as SequenceTrackProject | null | undefined)?.sequences ?? []) {
		const ids = sequence.trackNodes?.filter(({ kind }) => kind === 'track').map(({ id }) => id) ?? sequence.trackIds ?? [];
		if (trackId && ids.includes(trackId)) return new Set(ids);
	}
	return null;
}
