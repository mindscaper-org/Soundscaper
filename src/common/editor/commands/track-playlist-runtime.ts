/* SPDX-License-Identifier: AGPL-3.0-only */

import { captureTrackPlaylistState, installTrackPlaylistState, readTrackPlaylists, trackPlaylistName,
	type TrackPlaylists } from '../track-playlists.ts';
import type { TrackPlaylistCommand } from './track-playlist.ts';

export function applyTrackPlaylistCommand(projectValue: object, command: TrackPlaylistCommand): void {
	const project = projectValue as Record<string, unknown>;
	if (project.schemaFamily !== 'soundscaper') throw new RangeError('Track playlists require a Soundscaper project.');
	const track = (project.tracks as Record<string, unknown>[]).find(candidate => candidate.id === command.trackId);
	if (track?.type !== 'audio') throw new ReferenceError('Select an audio track for playlists.');
	if (track.locked) throw new RangeError('The playlist track is locked.');
	if (track.audioFreeze) throw new RangeError('Unfreeze the track before changing playlists.');
	const collections = readTrackPlaylists(project);
	let collection = collections.find(candidate => candidate.trackId === command.trackId);
	if (command.type === 'track/playlist-create') {
		if (command.mode !== 'empty' && command.mode !== 'duplicate') throw new RangeError('A playlist creation mode is required.');
		collection ??= { trackId: command.trackId, activeId: command.originalId,
			playlists: [{ id: command.originalId, name: trackPlaylistName(command.originalName), state: null }] };
		if (collection.playlists.some(entry => entry.id === command.id)) throw new RangeError('This playlist ID already exists.');
		const state = captureTrackPlaylistState(project, command.trackId);
		const activeId = collection.activeId;
		const next: TrackPlaylists = { ...collection, activeId: command.id, playlists: [
			...collection.playlists.map(entry => entry.id === activeId ? { ...entry, state } : entry),
			{ id: command.id, name: trackPlaylistName(command.name), state: null },
		] };
		if (command.mode === 'empty') installTrackPlaylistState(project, command.trackId, { clips: [], takeGroups: [] });
		publish(next);
		return;
	}
	const playlist = collection?.playlists.find(entry => entry.id === command.id);
	if (!collection || !playlist) throw new ReferenceError('Unknown track playlist.');
	if (command.type === 'track/playlist-activate') {
		if (collection.activeId === playlist.id) return;
		const state = captureTrackPlaylistState(project, command.trackId);
		installTrackPlaylistState(project, command.trackId, playlist.state!);
		publish({ ...collection, activeId: playlist.id, playlists: collection.playlists.map(entry =>
			entry.id === playlist.id ? { ...entry, state: null } : entry.id === collection.activeId ? { ...entry, state } : entry) });
	} else if (command.type === 'track/playlist-rename') {
		publish({ ...collection, playlists: collection.playlists.map(entry => entry.id === playlist.id
			? { ...entry, name: trackPlaylistName(command.name) } : entry) });
	} else {
		if (collection.activeId === playlist.id) throw new RangeError('Activate another playlist before deleting the active playlist.');
		publish({ ...collection, playlists: collection.playlists.filter(entry => entry.id !== playlist.id) });
	}
	function publish(next: TrackPlaylists): void {
		(project.metadata as Record<string, unknown>).trackPlaylists = [...collections.filter(entry => entry.trackId !== command.trackId), next];
		readTrackPlaylists(project);
	}
}

export function createTrackPlaylistCommandHandlers() {
	return {
		'track/playlist-create': applyTrackPlaylistCommand, 'track/playlist-activate': applyTrackPlaylistCommand,
		'track/playlist-rename': applyTrackPlaylistCommand, 'track/playlist-remove': applyTrackPlaylistCommand,
	};
}
