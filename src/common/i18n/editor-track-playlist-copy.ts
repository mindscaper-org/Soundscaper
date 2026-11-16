/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveEditorCopyScope } from './editor-copy-scope.ts';

export const TRACK_PLAYLIST_COPY_BY_LOCALE = Object.freeze({ en: Object.freeze({
	title: 'Track playlists',
	instructions: 'Keep alternate clip arrangements on this track. Switching saves your current edits and keeps the current mix and other tracks. Only the active playlist plays or exports.',
	name: 'Playlist name',
	create: 'Create empty playlist',
	duplicate: 'Duplicate current playlist',
	original: 'Original',
	list: 'Playlists',
	empty: 'Create a playlist to keep alternate edits. Your current arrangement will be preserved as Original.',
	active: 'active',
	activate: 'Activate playlist',
	rename: 'Rename playlist',
	remove: 'Delete playlist',
	close: 'Close',
}) });

export function resolveTrackPlaylistCopy(copy: Readonly<Record<string, string>>) {
	return resolveEditorCopyScope('trackPlaylists', TRACK_PLAYLIST_COPY_BY_LOCALE.en, copy);
}
