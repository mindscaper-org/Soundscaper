/* SPDX-License-Identifier: AGPL-3.0-only */
import type { DawprojectDocument } from './dawproject-import.ts';
import type { DawprojectMidiEvent } from './dawproject-import-midi.ts';
import { addDeliveryReportItem } from './delivery-report.ts';
import { readDawprojectMidiTrackComment } from './dawproject-midi-metadata.ts';
import { withMidiClipData, withMidiTrackData, type MidiClipData, type MidiInstrument } from './midi-model.ts';
import { trackForEvent, type Build, type DataRecord } from './dawproject-import-structure.ts';
import { dawprojectImportedClipFades } from './dawproject-import-fades.ts';
import { dawprojectImportColor } from './dawproject-colors.ts';

export interface DawprojectMidiSource {
	readonly sourceId: string;
	readonly frameCount: number;
	readonly sampleRate: number;
	readonly instrument: MidiInstrument;
	readonly data: MidiClipData;
}

export function appendDawprojectMidi(events: readonly DawprojectMidiEvent[], build: Build, document: DawprojectDocument,
	sources: DataRecord[], clips: DataRecord[], widths: Map<string, number>): readonly DawprojectMidiSource[] {
	const output: DawprojectMidiSource[] = [];
	const declared = new Map(document.tracks.flatMap(function walk(track): [string, string | null][] {
		return [...(track.id ? [[track.id, track.comment ?? null] as [string, string | null]] : []), ...track.children.flatMap(walk)];
	}));
	const convertedTracks = new Set<string>();
	for (const event of events) {
		const track = trackForEvent(event, build, document);
		const owner = readDawprojectMidiTrackComment(event.trackId ? declared.get(event.trackId) : null);
		Object.assign(track, withMidiTrackData({ ...track, type: 'audio' }, owner ?? { version: 1, instrument: 'triangle' }));
		const sourceId = build.createStableId('source'), clipId = build.createStableId('clip');
		const duration = event.endFrame - event.startFrame;
		const name = event.name ?? track.name;
		sources.push({ kind: 'audio', id: sourceId, storageKey: sourceId, name, mimeType: 'audio/wav',
			frameCount: duration, channelCount: 1, sampleRate: build.sampleRate });
		const color = dawprojectImportColor(event.color, build.draft, { kind: 'clip', id: clipId });
		clips.push(withMidiClipData({ kind: 'audio', id: clipId, title: name, sourceId,
			timelineStartFrame: event.startFrame, sourceStartFrame: 0, sourceDurationFrames: duration,
			durationFrames: duration, ...dawprojectImportedClipFades(event, event.startFrame, duration), ...(color ? { color } : {}) }, event.data));
		track.clipIds.push(clipId);
		widths.set(track.id, Math.max(widths.get(track.id) ?? 0, 1));
		output.push({ sourceId, sampleRate: build.sampleRate, frameCount: duration, instrument: owner?.instrument ?? 'triangle', data: event.data });
		addDeliveryReportItem(build.draft, { code: 'dawproject.midi-notes-preserved', disposition: 'preserved', severity: 'info',
			scope: { kind: 'clip', id: clipId }, data: { notes: event.data.notes.length, messages: event.data.interchange?.events.length ?? 0 },
			message: 'DAWproject notes become editable MIDI with a persisted synthesized audio fallback.' });
		if (!owner && !convertedTracks.has(track.id)) {
			convertedTracks.add(track.id);
			addDeliveryReportItem(build.draft, { code: 'dawproject.midi-instrument-converted', disposition: 'converted', severity: 'warning',
				scope: { kind: 'track', id: track.id }, message: 'The original instrument is unavailable; editable notes use the triangle synthesizer.' });
		}
		if (event.expressionsOmitted || event.staleMetadata) addDeliveryReportItem(build.draft, {
			code: 'dawproject.midi-expression-omitted', disposition: 'omitted', severity: 'warning',
			scope: { kind: 'clip', id: clipId }, data: { expressions: event.expressionsOmitted, staleMetadata: event.staleMetadata },
			message: 'Unsupported per-note expressions or stale application MIDI metadata are omitted; standard note performance is retained.',
		});
	}
	return Object.freeze(output);
}
