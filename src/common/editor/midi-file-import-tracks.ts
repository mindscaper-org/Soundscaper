/* SPDX-License-Identifier: AGPL-3.0-only */

import { routeMidiImportControls } from './midi-file-import-channel-routing.ts';
import type { MidiFileDocument } from './midi-file-types.ts';

/** Share standalone and container import routing, authored empty lanes and conductor extents. */
export function midiFileImportTracks(document: MidiFileDocument) {
	const routed = routeMidiImportControls(document.tracks);
	const authored = routed.filter((track, index) => track.notes.length || track.events?.length
		|| !track.conductorOnly && !document.tracks[index]?.events?.length);
	const tracks = authored.length ? authored : routed.slice(0, 1);
	const included = new Set(tracks);
	let emptyTrackEnd = 0;
	for (const track of routed) if (!included.has(track)) emptyTrackEnd = Math.max(emptyTrackEnd, track.durationFrames ?? 0);
	return tracks.map(track => ({ ...track, durationFrames: Math.max(track.durationFrames ?? 0, emptyTrackEnd) }));
}
