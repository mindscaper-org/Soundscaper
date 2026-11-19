/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainRecord } from '../foundation/closed-domain-value.ts';
import { collectTakeGroupSourceIds } from './take-group-source-references.ts';

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

export function collectTrackPlaylistSourceIds(project: unknown, target = new Set<string>()): Set<string> {
	for (const collection of readTrackPlaylists(project)) for (const { state } of collection.playlists) {
		if (!state) continue;
		for (const clip of state.clips) if (typeof clip.sourceId === 'string') target.add(clip.sourceId);
		collectTakeGroupSourceIds(state, target);
	}
	return target;
}

function stableId(value: unknown): string {
	if (typeof value !== 'string' || !value.trim() || value.length > 160 || value !== value.trim()
		|| [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
		throw new TypeError('A canonical playlist ID is required.');
	}
	return value;
}
export function record(value: unknown): Data | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : null;
}
export function dataRecord(value: unknown): Data {
	const result = record(value);
	if (!result) throw new TypeError('Playlist data must be a record.');
	return result;
}
export function records(value: unknown): Data[] { return Array.isArray(value) ? value.map(dataRecord) : []; }
