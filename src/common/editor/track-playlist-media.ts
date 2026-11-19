/* SPDX-License-Identifier: AGPL-3.0-only */

import { collectTrackPlaylistSourceIds, readTrackPlaylists } from './track-playlist-records.ts';
export { collectTrackPlaylistSourceIds } from './track-playlist-records.ts';
import { remapTakeGroupSourceIds } from './take-group-source-references.ts';
import { remapClipSourceReference } from './clip-source-stretch-memory.ts';

export function trackPlaylistUsesSource(project: unknown, sourceId: string): boolean {
	return collectTrackPlaylistSourceIds(project).has(sourceId);
}

export function remapTrackPlaylistSourceIds(project: unknown, map: ReadonlyMap<string, string>): void {
	for (const collection of readTrackPlaylists(project)) for (const { state } of collection.playlists) {
		if (!state) continue;
		for (const clip of state.clips) remapClipSourceReference(clip, map);
		remapTakeGroupSourceIds(state, map);
	}
}

/** An inactive arrangement must keep its original bytes and frame bounds through media rewrites. */
export function preserveTrackPlaylistSource(projectValue: object, sourceId: string): void {
	if (!trackPlaylistUsesSource(projectValue, sourceId)) return;
	const project = projectValue as Record<string, unknown>, sources = project.sources as Record<string, unknown>[];
	const source = sources.find(candidate => candidate.id === sourceId);
	if (!source) throw new ReferenceError('Playlist media is missing.');
	let index = 1, alias = `playlist-source-${String(index)}-${sourceId}`;
	while (sources.some(candidate => candidate.id === alias)) alias = `playlist-source-${String(++index)}-${sourceId}`;
	sources.push({ ...structuredClone(source), id: alias, storageKey: source.storageKey || sourceId });
	remapTrackPlaylistSourceIds(project, new Map([[sourceId, alias]]));
}
