/* SPDX-License-Identifier: AGPL-3.0-only */

import { readTrackPlaylists } from './track-playlists.ts';
import { readMidiClip } from './midi-model.ts';

export interface MidiPlaylistSourceReplacement {
	readonly playlistId: string;
	readonly clipId: string;
	readonly previousSourceId: string;
	readonly sourceId: string;
}

/** Instrument assignment is shared track state, including arrangements outside the live timeline. */
export function midiPlaylistSourceClips(project: unknown, trackId: string) {
	return (readTrackPlaylists(project).find(collection => collection.trackId === trackId)?.playlists ?? [])
		.flatMap(playlist => (playlist.state?.clips ?? []).filter(clip => readMidiClip(clip))
			.map(clip => ({ playlistId: playlist.id, clip })));
}

/** Publish only prepared source bindings, preserving each alternative's notes and timing. */
export function replaceMidiPlaylistSources(project: Readonly<Record<string, unknown>>, trackId: string,
	replacements: readonly MidiPlaylistSourceReplacement[] = []): void {
	if (!Array.isArray(replacements)) throw new TypeError('MIDI playlist source replacements must be an array.');
	if (!replacements.length) return;
	const clips = new Map(midiPlaylistSourceClips(project, trackId).map(({ playlistId, clip }) => [JSON.stringify([playlistId, clip.id]), clip]));
	const sources = project.sources as readonly Readonly<Record<string, unknown>>[];
	const sourceIds = new Set(sources.filter(source => source.kind === 'audio').map(source => source.id));
	for (const replacement of replacements) {
		const key = JSON.stringify([replacement.playlistId, replacement.clipId]);
		const target = clips.get(key);
		if (!target || target.sourceId !== replacement.previousSourceId) throw new ReferenceError('The saved MIDI playlist clip changed.');
		if (!sourceIds.has(replacement.sourceId)) throw new ReferenceError('A saved MIDI clip requires a stored audio source.');
		clips.delete(key); target.sourceId = replacement.sourceId;
	}
}
