/* SPDX-License-Identifier: AGPL-3.0-only */

import { readMidiClip, readMidiTrack, withMidiTrackData } from '../midi-model.ts';

type DataRecord = Record<string, unknown>;

/** A moved editable clip still needs a MIDI instrument owner in its new audio lane. */
export function inheritMidiTrackForTransfer(clip: DataRecord, source: DataRecord, target: DataRecord): void {
	if (source.id === target.id || target.type !== 'audio' || readMidiTrack(target)) return;
	const instrument = readMidiTrack(source);
	if (instrument && readMidiClip(clip)) Object.assign(target, withMidiTrackData(target, instrument));
}
