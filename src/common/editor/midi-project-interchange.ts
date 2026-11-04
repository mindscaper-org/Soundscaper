/* SPDX-License-Identifier: AGPL-3.0-only */
import { readMidiClip, readMidiTrack } from './midi-model.ts';
import { MIDI_FILE_MAX_EVENTS, validateMidiFileDocument, type MidiFileDocument, type MidiFileEvent } from './midi-file-types.ts';
import { midiProjectTiming } from './midi-project-timing.ts';
import { midiClipOccurrences } from './midi-project-source-projection.ts';
import { createMidiClipEventProjection } from './midi-project-event-projection.ts';

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
	const tracks = project.tracks.flatMap(track => {
		const metadata = readMidiTrack(track);
		if (!metadata) return [];
		const notes: MidiFileDocument['tracks'][number]['notes'][number][] = [];
		const events: MidiFileEvent[] = [];
		for (const id of Array.isArray(track.clipIds) ? track.clipIds : []) {
			const persistedClip = clipsById.get(String(id));
			const data = readMidiClip(persistedClip);
			if (!persistedClip || !data) continue;
			const eventProjection = createMidiClipEventProjection(data.interchange);
			const importedRootTempo = data.interchange?.tempos.find(tempo => tempo.frame === 0);
			const preserveTempos = !timing.hasTempoChanges && importedRootTempo && Math.abs(importedRootTempo.bpm - timing.tempos[0]!.bpm) < 0.000001;
			const importedRootSignature = data.interchange?.signatures.find(signature => signature.frame === 0);
			const preserveSignatures = !timing.hasSignatureChanges && importedRootSignature && importedRootSignature.numerator === timing.signatures[0]!.numerator
				&& importedRootSignature.denominator === timing.signatures[0]!.denominator;
			let occurrence = 0;
			for (const { start, sourceFrames, timelineStart, global } of midiClipOccurrences(projectionProject, persistedClip)) {
				const prefix = `${String(persistedClip.id)}${occurrence ? `:loop-${occurrence}` : ''}`;
				occurrence += 1;
				for (const note of data.notes) {
					const from = Math.max(start, note.startFrame);
					const to = Math.min(start + sourceFrames, note.startFrame + note.durationFrames);
					if (to <= from) continue;
					reserveEvents(1);
					notes.push({ ...note, id: `${prefix}:${note.id}`, startFrame: Math.min(global(from), global(to)), durationFrames: Math.max(1, Math.abs(global(to) - global(from))) });
				}
				const visible = eventProjection.events(start, sourceFrames, timelineStart, global);
				reserveEvents(visible.length);
				for (const event of visible) events.push(event);
				if (preserveTempos) {
					const visible = eventProjection.tempos(start, sourceFrames, timelineStart, global);
					addTiming(tempos, visible);
				}
				if (preserveSignatures) {
					const visible = eventProjection.signatures(start, sourceFrames, timelineStart, global);
					addTiming(signatures, visible);
				}
			}
		}
		return [{ name: String(track.name), notes, events, ...(metadata.program === undefined ? {} : { program: metadata.program }) }];
	});
	if (!tracks.length) throw new RangeError('The project has no MIDI tracks to export.');
	tempos.set(0, timing.tempos[0]!);
	signatures.set(0, timing.signatures[0]!);
	const document = { sampleRate: project.sampleRate, tracks, tempos: [...tempos.values()].sort(byFrame), signatures: [...signatures.values()].sort(byFrame) };
	validateMidiFileDocument(document);
	return document;
}

function byFrame(a: Readonly<{ frame: number }>, b: Readonly<{ frame: number }>): number { return a.frame - b.frame; }
