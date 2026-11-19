/* SPDX-License-Identifier: AGPL-3.0-only */

import { soundcraftSession } from './native-daw-import-fixtures.ts';

export function soundcraftNestedFolderSession() {
	const input = soundcraftSession(), audio = input.tracks[0]!;
	return { ...input, tracks: [
		{ ...audio, id: 80, name: 'Parent', kind: 'Folder', playlists: [], mixer: { ...audio.mixer, volume_db: -6 } },
		{ ...audio, folder: 80 },
		{ ...audio, id: 90, name: 'Child', kind: 'Folder', folder: 80, playlists: [], mixer: { ...audio.mixer, volume_db: -3 } },
		{ ...audio, id: 21, name: 'Child audio', folder: 90, playlists: audio.playlists.map(list => ({ ...list,
			clips: list.clips.map(clip => ({ ...clip, id: 41 })) })) },
	] };
}
