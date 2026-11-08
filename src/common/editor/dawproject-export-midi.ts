/* SPDX-License-Identifier: AGPL-3.0-only */
import { readMidiClip, readMidiTrack, type MidiNote, type MidiClipData } from './midi-model.ts';
import { midiClipOccurrences } from './midi-project-source-projection.ts';
import { createMidiClipNoteProjection } from './midi-project-note-projection.ts';
import { createMidiClipEventProjection } from './midi-project-event-projection.ts';
import { dawprojectMidiComment } from './dawproject-midi-metadata.ts';
import { xmlElement, type XmlElement } from './dawproject-xml.ts';
import { addDeliveryReportItem } from './delivery-report.ts';
import { reportOmittedClipFeatures } from './dawproject-export-clip-omissions.ts';
import type { DataRecord, DawprojectExportContext } from './dawproject-export-context.ts';
import type { MidiFileEvent, MidiFileTempo, MidiFileSignature } from './midi-file-types.ts';
import { midiProjectTiming } from './midi-project-timing.ts';
import { dawprojectExportColor } from './dawproject-colors.ts';

export function dawprojectTrackMidiAttributes(track: DataRecord, context: DawprojectExportContext) {
	const owner = readMidiTrack(track);
	const clips = Array.isArray(track.clipIds) ? track.clipIds.map(id => context.clipById.get(String(id))) : [];
	const hasNotes = owner !== null || clips.some(clip => readMidiClip(clip) !== null);
	const hasAudio = clips.some(clip => clip && readMidiClip(clip) === null);
	if (owner) addDeliveryReportItem(context.draft, { code: 'dawproject.midi-instrument-metadata', disposition: 'converted', severity: 'warning',
		scope: { kind: 'track', id: String(track.id) }, data: { instrument: owner.instrument, program: owner.program ?? null },
		message: 'Instrument and program settings are retained in a Soundscaper comment namespace; other DAWs must assign an instrument to the standard Notes.' });
	return { contentType: hasNotes ? hasAudio ? 'audio notes' : 'notes' : 'audio',
		...(owner ? { comment: dawprojectMidiComment(owner) } : {}) };
}

export function buildDawprojectMidiClip(clip: DataRecord, context: DawprojectExportContext): XmlElement | null {
	const midi = readMidiClip(clip);
	if (!midi) return null;
	const start = Number(clip.timelineStartFrame), duration = Number(clip.durationFrames);
	const project = { ...context.project, sampleRate: context.sampleRate, tempoMap: context.tempoMap ?? midiProjectTiming({ ...context.project, sampleRate: context.sampleRate }).tempoMap };
	const projectNote = createMidiClipNoteProjection(midi), projectEvent = createMidiClipEventProjection(midi.interchange);
	const notes: MidiNote[] = [], events: MidiFileEvent[] = [];
	const tempos: MidiFileTempo[] = [], signatures: MidiFileSignature[] = [];
	let count = 0;
	for (const occurrence of midiClipOccurrences(project, clip)) {
		const local = (frame: number): number => Math.max(0, occurrence.global(frame) - start);
		for (const note of projectNote(occurrence.start, occurrence.sourceFrames, local)) {
			notes.push({ ...note, id: count ? `${note.id}:loop-${count}` : note.id,
				...(note.onsetStop?.kind === 'all-notes-off' && count ? { onsetStop: { ...note.onsetStop, releaseId: `${note.onsetStop.releaseId}:loop-${count}` } } : {}) });
		}
		events.push(...projectEvent.events(occurrence.start, occurrence.sourceFrames,
			occurrence.timelineStart - start, local, occurrence.initializePerformance).map(event =>
				count && event.releaseId ? { ...event, releaseId: `${event.releaseId}:loop-${count}` } : event));
		const visibleTiming = <Value extends Readonly<{ frame: number }>>(values: readonly Value[]): Value[] => values
			.filter(event => event.frame >= occurrence.start && event.frame < occurrence.start + occurrence.sourceFrames)
			.map(event => ({ ...event, frame: local(event.frame) }));
		tempos.push(...visibleTiming(midi.interchange?.tempos ?? []));
		signatures.push(...visibleTiming(midi.interchange?.signatures ?? []));
		count += 1;
		if (notes.length + events.length > 1_000_000) throw new RangeError('DAWproject MIDI delivery contains too many events.');
	}
	const data: MidiClipData = { version: 1, notes, ...(midi.interchange ? { interchange: {
		events, tempos, signatures,
	} } : {}) };
	addDeliveryReportItem(context.draft, { code: 'dawproject.midi-notes-preserved', disposition: 'preserved', severity: 'info',
		scope: { kind: 'clip', id: String(clip.id) }, data: { notes: notes.length, messages: events.length },
		message: 'Editable notes use standard DAWproject Notes. Auxiliary MIDI messages and source note details use a Soundscaper comment namespace.' });
	reportOmittedClipFeatures(clip, String(clip.id), false, context);
	return xmlElement('Clip', { time: start / context.sampleRate, duration: duration / context.sampleRate,
		contentTimeUnit: 'seconds', playStart: 0, enable: true, name: String(clip.title ?? 'MIDI'), color: dawprojectExportColor(clip.color),
		fadeTimeUnit: 'seconds', fadeInTime: Number(clip.fadeInFrames ?? 0) / context.sampleRate,
		fadeOutTime: Number(clip.fadeOutFrames ?? 0) / context.sampleRate,
	}, [xmlElement('Notes', { timeUnit: 'seconds', id: context.ids.id('notes', String(clip.id)),
		comment: dawprojectMidiComment({ sampleRate: context.sampleRate, data }) }, notes.map(note => xmlElement('Note', {
		time: note.startFrame / context.sampleRate, duration: note.durationFrames / context.sampleRate,
		channel: note.channel, key: note.pitch, vel: note.velocity / 127,
		...(note.releaseVelocity === undefined ? {} : { rel: note.releaseVelocity / 127 }),
	}))) ]);
}
