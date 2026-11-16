/* SPDX-License-Identifier: AGPL-3.0-only */

import { routeMidiImportControls } from './midi-file-import-channel-routing.ts';
import type { MidiFileDocument } from './midi-file-types.ts';

/** Share standalone and container import routing, authored empty lanes and conductor extents. */
export function midiFileImportTracks(document: MidiFileDocument) {
	const routed = routeMidiImportControls(document.tracks);
	const authored = routed.filter((track, index) => track.notes.length || track.events?.length
		|| !track.conductorOnly && !document.tracks[index]?.events?.length);
	const tracks = authored.length ? authored : routed.slice(0, 1);
	const emptyTrackEnd = routed.filter(track => !tracks.includes(track)).reduce((end, track) => Math.max(end, track.durationFrames ?? 0), 0);
	return tracks.map(track => ({ ...track, durationFrames: Math.max(track.durationFrames ?? 0, emptyTrackEnd) }));
}
