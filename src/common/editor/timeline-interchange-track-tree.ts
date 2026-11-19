/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TimelineInterchangeDocument } from './timeline-interchange-types.ts';
import type { TrackNodeV12 } from './track-hierarchy-v12.ts';

/** Group each imported subtree before emitting the canonical flat hierarchy. */
export function timelineInterchangeTrackTree(document: TimelineInterchangeDocument,
	trackIds: ReadonlyMap<string, string>, folderIds: ReadonlyMap<string, string>): TrackNodeV12[] {
	const folderId = (id: string | null | undefined): string | null => {
		if (id == null) return null;
		const resolved = folderIds.get(id);
		if (!resolved) throw new ReferenceError(`Unknown imported parent folder: ${id}.`);
		return resolved;
	};
	const nodes: TrackNodeV12[] = [
		...(document.folders ?? []).map(folder => ({ kind: 'folder' as const, id: folderIds.get(folder.id)!, parentFolderId: folderId(folder.parentFolderId) })),
		...document.tracks.map(track => ({ kind: 'track' as const, id: trackIds.get(track.id)!, parentFolderId: folderId(track.folderId) })),
	];
	const children = new Map<string | null, TrackNodeV12[]>();
	for (const node of nodes) {
		const siblings = children.get(node.parentFolderId) ?? [];
		siblings.push(node); children.set(node.parentFolderId, siblings);
	}
	const pending = [...children.get(null) ?? []].reverse(), result: TrackNodeV12[] = [];
	const visited = new Set<string>();
	while (pending.length) {
		const node = pending.pop()!;
		if (visited.has(node.id)) throw new RangeError('Imported track hierarchy contains duplicate identities.');
		visited.add(node.id); result.push(node);
		const descendants = children.get(node.id) ?? [];
		for (let index = descendants.length - 1; index >= 0; index--) pending.push(descendants[index]!);
	}
	if (result.length !== nodes.length) throw new RangeError('Imported track folders contain a cycle.');
	return result;
}
