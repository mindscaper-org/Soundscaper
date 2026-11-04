/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeMidiTrackData, readMidiClip, readMidiTrack, withMidiTrackData } from '../midi-model.ts';

type DataRecord = Record<string, unknown>;
const TRACK_KEY = 'soundscaper.midi.track-context';

/** Carry the instrument while an editable clip travels without its original track. */
export function midiTransferExtensions(clip: DataRecord, track: DataRecord): DataRecord {
	const extensions = { ...clip.opaqueExtensions as DataRecord | undefined };
	delete extensions[TRACK_KEY];
	const instrument = readMidiTrack(track);
	if (instrument && readMidiClip(clip)) extensions[TRACK_KEY] = instrument;
	return extensions;
}

/** Restore the destination owner and consume context when material reaches a timeline lane. */
export function adoptMidiTransferContext<Value extends DataRecord>(clip: Value, track: DataRecord): Value {
	const extensions = clip.opaqueExtensions as DataRecord | undefined;
	if (!extensions || !Object.hasOwn(extensions, TRACK_KEY)) return clip;
	const instrument = normalizeMidiTrackData(extensions[TRACK_KEY]);
	if (readMidiClip(clip) && track.type === 'audio' && !readMidiTrack(track)) {
		Object.assign(track, withMidiTrackData(track, instrument));
	}
	const retained = { ...extensions };
	delete retained[TRACK_KEY];
	return { ...clip, opaqueExtensions: retained };
}

/** Capture owners before a group of timeline clips moves into a trackless media bin. */
export function midiBinTransferContexts(clips: readonly DataRecord[], tracks: readonly DataRecord[]): ReadonlyMap<unknown, DataRecord> {
	const selected = new Map(clips.map(clip => [clip.id, clip]));
	const contexts = new Map<unknown, DataRecord>();
	for (const track of tracks) {
		if (!readMidiTrack(track) || !Array.isArray(track.clipIds)) continue;
		for (const id of track.clipIds) {
			const clip = selected.get(id);
			if (clip && readMidiClip(clip)) contexts.set(id, { opaqueExtensions: midiTransferExtensions(clip, track) });
		}
	}
	return contexts;
}
