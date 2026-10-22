/* SPDX-License-Identifier: AGPL-3.0-only */
import type { DocumentTrackFolderSnapshot } from '../../controller/document/document-track-folder-snapshot.ts';

/** Apply presentation-only collapse choices without changing audibility or the document. */
export function inspectTrackFolderSnapshot(
	snapshot: DocumentTrackFolderSnapshot | null | undefined,
	collapsedOverrides: ReadonlyMap<string, boolean>,
): DocumentTrackFolderSnapshot | null | undefined {
	if (!snapshot || collapsedOverrides.size === 0) return snapshot;
	const collapsedById = new Map<string, boolean>();
	for (const sequence of snapshot.sequences) {
		for (const row of sequence.rows) {
			if (row.kind === 'folder') collapsedById.set(row.id, collapsedOverrides.get(row.id) ?? row.collapsed);
		}
	}
	return {
		...snapshot,
		sequences: snapshot.sequences.map(sequence => ({
			...sequence,
			rows: sequence.rows.map(row => ({
				...row,
				...(row.kind === 'folder' ? { collapsed: collapsedById.get(row.id) === true } : {}),
				rowHidden: row.ancestorFolderIds.some(id => collapsedById.get(id) === true),
			})),
		})),
	};
}
