/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainRecord } from '../foundation/closed-domain-value.ts';
import { createTakeCompDocumentGroupsV17 } from './take-comp-document-v17.ts';
import { reconcileProjectOwnedFeatureRequirements } from './project-owned-feature-requirements.ts';
import type { ProjectFeatureRequirementsManifest } from './project-feature-requirements.ts';

type Data = Record<string, unknown>;
export const TRACK_PLAYLIST_LIMIT = 64;
export const TRACK_PLAYLIST_NAME_LIMIT = 160;

export interface TrackPlaylistState {
	readonly clips: readonly Data[];
	readonly takeGroups: readonly Data[];
}
export interface TrackPlaylist {
	readonly id: string;
	readonly name: string;
	/** The active playlist lives exclusively in the ordinary timeline. */
	readonly state: TrackPlaylistState | null;
}
export interface TrackPlaylists {
	readonly trackId: string;
	readonly activeId: string;
	readonly playlists: readonly TrackPlaylist[];
}

export function trackPlaylistName(value: unknown): string {
	if (typeof value !== 'string' || !value.trim() || value.trim().length > TRACK_PLAYLIST_NAME_LIMIT) {
		throw new TypeError('A playlist name of 1–160 characters is required.');
	}
	return value.trim();
}

/** Named alternatives own only clip arrangements and take comps, never track mix state. */
export function readTrackPlaylists(projectValue: unknown): readonly TrackPlaylists[] {
	const project = record(projectValue), metadata = record(project?.metadata);
	if (metadata?.trackPlaylists === undefined) return [];
	const trackIds = new Set<string>();
	return readClosedDomainArray(metadata.trackPlaylists, 'track playlists', 0, 4096).map(value => {
		const collection = readClosedDomainRecord(value, 'track playlists', ['trackId', 'activeId', 'playlists'], ['trackId', 'activeId', 'playlists']);
		const trackId = collection.trackId, activeId = stableId(collection.activeId);
		if (typeof trackId !== 'string' || !trackId) throw new TypeError('A playlist track ID is required.');
		if (trackIds.has(trackId)) throw new RangeError('Duplicate track playlist collection.');
		trackIds.add(trackId);
		const track = records(project?.tracks).find(candidate => candidate.id === trackId);
		if (track?.type !== 'audio') throw new ReferenceError('Track playlists require an existing audio track.');
		const ids = new Set<string>();
		const playlists = readClosedDomainArray(collection.playlists, 'playlists', 1, TRACK_PLAYLIST_LIMIT).map(entry => {
			const playlist = readClosedDomainRecord(entry, 'playlist', ['id', 'name', 'state'], ['id', 'name', 'state']);
			const id = stableId(playlist.id), name = trackPlaylistName(playlist.name);
			if (ids.has(id)) throw new RangeError('Duplicate playlist ID.');
			ids.add(id);
			if (id === activeId) {
				if (playlist.state !== null) throw new TypeError('The active playlist must use the live timeline.');
				return { id, name, state: null };
			}
			const state = readClosedDomainRecord(playlist.state, 'playlist state', ['clips', 'takeGroups'], ['clips', 'takeGroups']);
			const clips = readClosedDomainArray(state.clips, 'playlist clips', 0, 100000).map(dataRecord);
			const takeGroups = readClosedDomainArray(state.takeGroups, 'playlist take groups', 0, 4096).map(dataRecord);
			if (clips.some(clip => typeof clip.id !== 'string' || !clip.id)
				|| new Set(clips.map(clip => clip.id)).size !== clips.length) throw new RangeError('Playlist clips must have unique IDs.');
			if (takeGroups.some(group => group.trackId !== trackId)) throw new RangeError('Playlist take groups must belong to their track.');
			return { id, name, state: { clips, takeGroups } };
		});
		if (!ids.has(activeId)) throw new ReferenceError('The active playlist is missing.');
		return { trackId, activeId, playlists };
	});
}

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

function stableId(value: unknown): string {
	if (typeof value !== 'string' || !value.trim() || value.length > 160 || value !== value.trim()
		|| [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
		throw new TypeError('A canonical playlist ID is required.');
	}
	return value;
}
function record(value: unknown): Data | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : null;
}
function dataRecord(value: unknown): Data {
	const result = record(value);
	if (!result) throw new TypeError('Playlist data must be a record.');
	return result;
}
function records(value: unknown): Data[] { return Array.isArray(value) ? value.map(dataRecord) : []; }
