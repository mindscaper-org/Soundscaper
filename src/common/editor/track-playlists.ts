/* SPDX-License-Identifier: AGPL-3.0-only */

import { createTakeCompDocumentGroupsV17 } from './take-comp-document-v17.ts';
import { reconcileProjectOwnedFeatureRequirements } from './project-owned-feature-requirements.ts';
import type { ProjectFeatureRequirementsManifest } from './project-feature-requirements.ts';
import { reconcileTrackPlaylistAvLinks } from './track-playlist-av-links.ts';

import { readTrackPlaylists, record, dataRecord, records, type TrackPlaylistState } from './track-playlist-records.ts';
export { readTrackPlaylists, trackPlaylistName, TRACK_PLAYLIST_LIMIT, TRACK_PLAYLIST_NAME_LIMIT } from './track-playlist-records.ts';
export type { TrackPlaylist, TrackPlaylists, TrackPlaylistState } from './track-playlist-records.ts';

type Data = Record<string, unknown>;

export function captureTrackPlaylistState(project: Data, trackId: string): TrackPlaylistState {
	const track = records(project.tracks).find(candidate => candidate.id === trackId);
	const ids = new Set(track?.clipIds as string[]);
	return structuredClone({
		clips: records(project.clips).filter(clip => ids.has(String(clip.id))),
		takeGroups: records(project.takeGroups).filter(group => group.trackId === trackId),
	});
}

/** Install one arrangement; clip identities moved to another track get fresh local aliases. */
export function installTrackPlaylistState(project: Data, trackId: string, state: TrackPlaylistState): void {
	const track = records(project.tracks).find(candidate => candidate.id === trackId);
	if (!track) throw new ReferenceError('The playlist track is missing.');
	const outgoingIds = new Set(track.clipIds as string[]);
	const others = records(project.clips).filter(clip => !outgoingIds.has(String(clip.id)));
	const projectBin = record(project.projectBin);
	const usedIds = new Set([...others, ...records(projectBin?.clips)].map(clip => String(clip.id)));
	const clips = structuredClone(state.clips) as Data[];
	for (const clip of clips) {
		const original = String(clip.id);
		let id = original, suffix = 1;
		while (usedIds.has(id)) id = `${original.slice(0, 100)}-playlist-${String(suffix++)}`;
		clip.id = id; usedIds.add(id);
	}
	reconcileTrackPlaylistAvLinks(project, track, records(project.clips).filter(clip => outgoingIds.has(String(clip.id))), others, clips);
	track.clipIds = clips.map(clip => clip.id);
	project.clips = [...others, ...clips];
	project.takeGroups = createTakeCompDocumentGroupsV17([
		...records(project.takeGroups).filter(group => group.trackId !== trackId), ...structuredClone(state.takeGroups),
	], project);
	const selection = record(project.selection);
	if (selection && Array.isArray(selection.clipIds)) {
		selection.clipIds = selection.clipIds.filter(id => !outgoingIds.has(String(id)));
	}
}

/** Validate stored alternatives with the same project validators used by live edits. */
export function validateTrackPlaylists(projectValue: unknown, validate: (project: unknown) => unknown,
	prepareDraft?: (project: Data, trackId: string) => void): void {
	const project = dataRecord(projectValue);
	const metadata = { ...dataRecord(project.metadata) };
	delete metadata.trackPlaylists;
	delete metadata.sessionSnapshots;
	for (const collection of readTrackPlaylists(project)) for (const playlist of collection.playlists) {
		if (!playlist.state) continue;
		const draft: Data = structuredClone({ ...project, metadata });
		prepareDraft?.(draft, collection.trackId);
		installTrackPlaylistState(draft, collection.trackId, playlist.state);
		draft.featureRequirements = reconcileProjectOwnedFeatureRequirements(draft,
			draft.featureRequirements as ProjectFeatureRequirementsManifest);
		validate(draft);
	}
}

export function removeTrackPlaylistCollections(projectValue: unknown, removedIds: ReadonlySet<string>): void {
	const metadata = record(record(projectValue)?.metadata);
	if (!metadata || !Array.isArray(metadata.trackPlaylists)) return;
	const remaining = metadata.trackPlaylists.filter(value => !removedIds.has(String(record(value)?.trackId)));
	metadata.trackPlaylists = remaining;
	if (remaining.length === 0) delete metadata.trackPlaylists;
}
