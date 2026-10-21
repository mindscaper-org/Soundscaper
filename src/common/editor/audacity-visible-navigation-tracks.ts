/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DocumentTrackFolderSnapshot } from './controller/document/document-track-folder-snapshot.ts';

/** Global navigation follows the same collapsed hierarchy as the track rows. */
export function visibleNavigationTracks<T extends Readonly<{ id: string }>>(
	tracks: readonly T[],
	folders: DocumentTrackFolderSnapshot | null | undefined,
	project: Readonly<Record<string, unknown>> | null | undefined = null,
): readonly T[] {
	const sequence = Array.isArray(project?.sequences) ? project.sequences.find((value: unknown) => {
		return value !== null && typeof value === 'object' && (value as { id?: unknown }).id === project.primarySequenceId;
	}) as Readonly<Record<string, unknown>> | undefined : undefined;
	const members = sequence && Array.isArray(sequence.trackNodes)
		? new Set(sequence.trackNodes.flatMap((value: unknown) => {
			const node = value as { kind?: unknown; id?: unknown } | null;
			return node?.kind === 'track' && typeof node.id === 'string' ? [node.id] : [];
		})) : sequence && Array.isArray(sequence.trackIds) ? new Set(sequence.trackIds) : null;
	const hidden = new Set(folders?.sequences.flatMap(sequence => sequence.rows
		.filter(row => row.kind === 'track' && row.rowHidden).map(row => row.id)));
	return hidden.size || members ? tracks.filter(track => !hidden.has(track.id) && (!members || members.has(track.id))) : tracks;
}
