/* SPDX-License-Identifier: AGPL-3.0-only */

import { readTrackPlaylists } from './track-playlists.ts';
import { collectTakeGroupSourceIds, remapTakeGroupSourceIds } from './take-group-source-references.ts';
import { CLIP_SOURCE_STRETCH_EXTENSION } from './clip-source-stretch-memory.ts';

export function collectTrackPlaylistSourceIds(project: unknown, target = new Set<string>()): Set<string> {
	for (const collection of readTrackPlaylists(project)) for (const { state } of collection.playlists) {
		if (!state) continue;
		for (const clip of state.clips) if (typeof clip.sourceId === 'string') target.add(clip.sourceId);
		collectTakeGroupSourceIds(state, target);
	}
	return target;
}

export function trackPlaylistUsesSource(project: unknown, sourceId: string): boolean {
	return collectTrackPlaylistSourceIds(project).has(sourceId);
}

export function remapTrackPlaylistSourceIds(project: unknown, map: ReadonlyMap<string, string>): void {
	for (const collection of readTrackPlaylists(project)) for (const { state } of collection.playlists) {
		if (!state) continue;
		for (const clip of state.clips) {
			const id = String(clip.sourceId), replacement = map.get(id);
			if (replacement === undefined) continue;
			clip.sourceId = replacement;
			const extensions = clip.opaqueExtensions as Record<string, Record<string, unknown>> | undefined;
			const memory = extensions?.[CLIP_SOURCE_STRETCH_EXTENSION];
			if (memory?.sourceId === id) memory.sourceId = replacement;
		}
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
