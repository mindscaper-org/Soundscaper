/* SPDX-License-Identifier: AGPL-3.0-only */
import { readMidiClip, readMidiTrack } from './midi-model.ts';
import { MIDI_FILE_MAX_EVENTS, validateMidiFileDocument, type MidiFileDocument, type MidiFileEvent, type MidiFileSignature } from './midi-file-types.ts';
import { midiProjectTiming } from './midi-project-timing.ts';
import { midiInitialTimingEvent } from './midi-initial-timing.ts';
import { midiClipOccurrences } from './midi-project-source-projection.ts';
import { createMidiClipEventProjection } from './midi-project-event-projection.ts';
import { createMidiClipNoteProjection } from './midi-project-note-projection.ts';
import { assertMidiClipTailBoundaries, type MidiClipTailBoundary } from './midi-project-clip-tail-boundaries.ts';

interface MidiExportProject extends Readonly<Record<string, unknown>> {
	readonly sampleRate: number;
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
	readonly clips: readonly Readonly<Record<string, unknown>>[];
	readonly tempo?: Readonly<{ bpm?: number; timeSignature?: Readonly<{ numerator?: number; denominator?: number }> }>;
}

/** Export the audible placement of MIDI clips; trimmed portions stay in the project. */
export function midiDocumentFromProject(project: MidiExportProject): MidiFileDocument {
	const timing = midiProjectTiming(project);
	const projectionProject = { sampleRate: project.sampleRate, tempoMap: timing.tempoMap };
	const tempos = new Map(timing.tempos.map(tempo => [tempo.frame, tempo]));
	const signatures = new Map(timing.signatures.map(signature => [signature.frame, signature]));
	let preservedRootSignature: MidiFileSignature | undefined;
	let eventCount = tempos.size + signatures.size;
	const reserveEvents = (count: number): void => {
		eventCount += count;
		if (eventCount > MIDI_FILE_MAX_EVENTS) throw new RangeError('MIDI export contains too many events.');
	};
	const addTiming = <Value extends Readonly<{ frame: number }>>(target: Map<number, Value>, values: readonly Value[]): void => {
		for (const value of values) {
			if (!target.has(value.frame)) reserveEvents(1);
			target.set(value.frame, value);
		}
	};
	const clipsById = new Map(project.clips.map(clip => [String(clip.id), clip]));
	const boundaries: MidiClipTailBoundary[] = [];
	const tracks = project.tracks.flatMap(track => {
		const metadata = readMidiTrack(track);
		if (!metadata) return [];
		const notes: MidiFileDocument['tracks'][number]['notes'][number][] = [];
		const events: MidiFileEvent[] = [];
		let durationFrames = 0;
		for (const id of Array.isArray(track.clipIds) ? track.clipIds : []) {
			const persistedClip = clipsById.get(String(id));
			const data = readMidiClip(persistedClip);
			if (!persistedClip || !data) continue;
			const eventProjection = createMidiClipEventProjection(data.interchange);
			const noteProjection = createMidiClipNoteProjection(data);
			const importedRootTempo = data.interchange && midiInitialTimingEvent(data.interchange.tempos);
			const preserveTempos = !timing.hasTempoChanges && importedRootTempo && Math.abs(importedRootTempo.bpm - timing.tempos[0]!.bpm) < 0.000001;
			const importedRootSignature = data.interchange && midiInitialTimingEvent(data.interchange.signatures);
			const preserveSignatures = !timing.hasSignatureChanges && importedRootSignature && importedRootSignature.numerator === timing.signatures[0]!.numerator
				&& importedRootSignature.denominator === timing.signatures[0]!.denominator;
			if (preserveSignatures && !preservedRootSignature) preservedRootSignature = importedRootSignature;
			let occurrence = 0;
			const firstNote = notes.length;
			let clipEnd = 0;
			for (const { start, sourceFrames, timelineStart, timelineEnd, global, initializePerformance } of midiClipOccurrences(projectionProject, persistedClip)) {
				durationFrames = Math.max(durationFrames, timelineEnd);
				clipEnd = Math.max(clipEnd, timelineEnd);
				const prefix = `${String(persistedClip.id)}${occurrence ? `:loop-${occurrence}` : ''}`;
				occurrence += 1;
				for (const note of noteProjection(start, sourceFrames, global)) {
					reserveEvents(1);
					const onsetStop = note.onsetStop?.kind === 'all-notes-off'
						? { ...note.onsetStop, releaseId: `${prefix}:${note.onsetStop.releaseId}` } : note.onsetStop;
					notes.push({ ...note, id: `${prefix}:${note.id}`, ...(onsetStop ? { onsetStop } : {}) });
				}
				const visible = eventProjection.events(start, sourceFrames, timelineStart, global, initializePerformance);
				reserveEvents(visible.length);
				for (const event of visible) events.push(event.releaseId === undefined ? event : { ...event, releaseId: `${prefix}:${event.releaseId}` });
				if (preserveTempos) {
					const visible = eventProjection.tempos(start, sourceFrames, timelineStart, global, initializePerformance);
					addTiming(tempos, visible);
				}
				if (preserveSignatures) {
					const visible = eventProjection.signatures(start, sourceFrames, timelineStart, global, initializePerformance);
					addTiming(signatures, visible);
				}
			}
			if (notes.length > firstNote) boundaries.push({ notes: notes.slice(firstNote), events, endFrame: clipEnd });
		}
		return [{ name: String(track.name), notes, events, durationFrames, ...(metadata.program === undefined ? {} : { program: metadata.program }) }];
	});
	if (!tracks.length) throw new RangeError('The project has no MIDI tracks to export.');
	tempos.set(0, timing.tempos[0]!);
	signatures.set(0, { ...preservedRootSignature, ...timing.signatures[0]! });
	const document = { sampleRate: project.sampleRate, tracks, tempos: [...tempos.values()].sort(byFrame), signatures: [...signatures.values()].sort(byFrame) };
	validateMidiFileDocument(document);
	assertMidiClipTailBoundaries(document, boundaries);
	return document;
}

function byFrame(a: Readonly<{ frame: number }>, b: Readonly<{ frame: number }>): number { return a.frame - b.frame; }
