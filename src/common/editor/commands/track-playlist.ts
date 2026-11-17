/* SPDX-License-Identifier: AGPL-3.0-only */

export const TRACK_PLAYLIST_COMMAND_TYPES = [
	'track/playlist-create', 'track/playlist-activate', 'track/playlist-rename', 'track/playlist-remove',
] as const;
export interface TrackPlaylistCommandPayloads {
	readonly 'track/playlist-create': {
		readonly trackId: string; readonly id: string; readonly name: string;
		readonly originalId: string; readonly originalName: string; readonly mode: 'empty' | 'duplicate';
	};
	readonly 'track/playlist-activate': { readonly trackId: string; readonly id: string };
	readonly 'track/playlist-rename': { readonly trackId: string; readonly id: string; readonly name: string };
	readonly 'track/playlist-remove': { readonly trackId: string; readonly id: string };
}
export type TrackPlaylistCommand = { [Key in keyof TrackPlaylistCommandPayloads]:
	Readonly<{ type: Key }> & TrackPlaylistCommandPayloads[Key]
}[keyof TrackPlaylistCommandPayloads];
