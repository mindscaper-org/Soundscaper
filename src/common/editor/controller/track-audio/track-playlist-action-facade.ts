/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TrackPlaylistCommand } from '../../commands/track-playlist.ts';
import { trackPlaylistName } from '../../track-playlists.ts';
import type { EditorProjectToken } from '../shared/lifecycle.ts';

interface Dependencies {
	getProject(): Readonly<{ id: string; schemaFamily?: unknown; tracks: readonly Readonly<{
		id: string; type: string; locked?: unknown; audioFreeze?: unknown;
	}>[] }> | null;
	createId(prefix: string): string;
	commit(command: TrackPlaylistCommand): unknown;
	prepare(): PromiseLike<unknown> | unknown;
	assertActive(): void;
	captureGeneration?(): EditorProjectToken;
	assertGeneration?(token: EditorProjectToken): void;
}

/** Flush pending MIDI edits before changing the selected track's live clip arrangement. */
export function createTrackPlaylistActionFacade(dependencies: Dependencies) {
	function requireTrack(trackId: string) {
		dependencies.assertActive();
		const project = dependencies.getProject();
		if (project?.schemaFamily !== 'soundscaper') throw new RangeError('Track playlists require a Soundscaper project.');
		const track = project.tracks.find(candidate => candidate.id === trackId);
		if (track?.type !== 'audio') throw new ReferenceError('The playlist track is unavailable.');
		if (track.locked) throw new RangeError('The playlist track is locked.');
		if (track.audioFreeze) throw new RangeError('Unfreeze the track before changing playlists.');
		return project;
	}
	async function prepare(trackId: string): Promise<void> {
		const project = requireTrack(trackId), generation = dependencies.captureGeneration?.();
		await dependencies.prepare();
		if (generation) dependencies.assertGeneration?.(generation);
		if (requireTrack(trackId).id !== project.id) throw new DOMException('The playlist project changed.', 'AbortError');
	}
	return Object.freeze({
		async create(trackId: string, name: string, mode: 'empty' | 'duplicate', originalName: string): Promise<string> {
			const normalized = trackPlaylistName(name), original = trackPlaylistName(originalName);
			await prepare(trackId);
			const id = dependencies.createId('playlist');
			dependencies.commit({ type: 'track/playlist-create', trackId, id, name: normalized,
				originalId: dependencies.createId('playlist'), originalName: original, mode });
			return id;
		},
		async activate(trackId: string, id: string): Promise<void> {
			await prepare(trackId);
			dependencies.commit({ type: 'track/playlist-activate', trackId, id });
		},
		rename(trackId: string, id: string, name: string): void {
			requireTrack(trackId);
			dependencies.commit({ type: 'track/playlist-rename', trackId, id, name: trackPlaylistName(name) });
		},
		remove(trackId: string, id: string): void {
			requireTrack(trackId);
			dependencies.commit({ type: 'track/playlist-remove', trackId, id });
		},
	});
}
