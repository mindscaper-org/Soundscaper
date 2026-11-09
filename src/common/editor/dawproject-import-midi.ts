/* SPDX-License-Identifier: AGPL-3.0-only */
import { attribute, childElements, numberAttribute, type XmlElement } from './dawproject-xml.ts';
import { normalizeMidiClipData, normalizeMidiNote, type MidiClipData, type MidiNote } from './midi-model.ts';
import type { DawprojectFadeLayer } from './dawproject-import-fades.ts';
import { readDawprojectMidiClipComment } from './dawproject-midi-metadata.ts';

export interface DawprojectMidiEvent {
	readonly trackId: string | null;
	readonly startFrame: number;
	readonly endFrame: number;
	readonly name: string | null;
	readonly color: string | null;
	readonly enabled: boolean;
	readonly fadeInFrames: number;
	readonly fadeOutFrames: number;
	readonly fadeLayers?: readonly DawprojectFadeLayer[];
	readonly contentStopFrame?: number | null;
	readonly data: MidiClipData;
	readonly expressionsOmitted: number;
	readonly staleMetadata: boolean;
}

interface MidiScope {
	readonly trackId: string | null;
	readonly sampleRate: number;
	readonly name: string | null;
	readonly color: string | null;
	readonly enabled: boolean;
	readonly fadeInFrames: number;
	readonly fadeOutFrames: number;
	readonly fadeLayers?: readonly DawprojectFadeLayer[];
	readonly contentStopFrame?: number | null;
	readonly startFrame: number;
	readonly endFrame: number | null;
	frameAt(time: number): number;
}

/** The surrounding arrangement walker owns aliases, nested windows and beat/second rebasing. */
export function readDawprojectNotes(element: XmlElement, scope: MidiScope): DawprojectMidiEvent | null {
	if (!scope.enabled) return null;
	const input = childElements(element, 'Note');
	if (input.length > 200_000) throw new RangeError('DAWproject contains too many MIDI notes.');
	const start = Math.max(0, scope.startFrame);
	let end = scope.endFrame;
	let expressionsOmitted = 0;
	const notes: MidiNote[] = [];
	for (const [index, child] of input.entries()) {
		const time = numberAttribute(child, 'time'), duration = numberAttribute(child, 'duration');
		const pitch = numberAttribute(child, 'key'), channel = numberAttribute(child, 'channel') ?? 0;
		if (time === null || duration === null || duration <= 0 || pitch === null) throw new RangeError('Invalid DAWproject MIDI note time, duration or key.');
		const from = scope.frameAt(time), to = scope.frameAt(time + duration);
		const velocity = normalizedVelocity(child, 'vel', 1), release = numberAttribute(child, 'rel');
		// Validate even notes outside the containing window before discarding them.
		const note = normalizeMidiNote({ id: `dawproject-note-${index}`, pitch, channel,
			startFrame: Math.max(0, from - start), durationFrames: Math.max(1, to - from), velocity,
			...(release === null ? {} : { releaseVelocity: normalizedVelocity(child, 'rel', 0) }) });
		expressionsOmitted += child.children.length;
		const clippedStart = Math.max(start, from), clippedEnd = Math.min(end ?? Infinity, scope.contentStopFrame ?? Infinity, to);
		if (clippedEnd <= clippedStart) continue;
		notes.push({ ...note, startFrame: clippedStart - start, durationFrames: clippedEnd - clippedStart });
	}
	end ??= start + notes.reduce((maximum, note) => Math.max(maximum, note.startFrame + note.durationFrames), 1);
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) throw new RangeError('DAWproject MIDI extent exceeds the sample frame range.');
	if (end <= start) return null;
	let data: MidiClipData = normalizeMidiClipData({ version: 1, notes });
	const metadata = readDawprojectMidiClipComment(attribute(element, 'comment'), scope.sampleRate);
	const consistent = metadata && sameNotePerformance(metadata.notes, notes);
	if (consistent) data = metadata;
	return { trackId: scope.trackId, startFrame: start, endFrame: end, name: scope.name, color: scope.color,
		enabled: true, fadeInFrames: scope.fadeInFrames, fadeOutFrames: scope.fadeOutFrames,
		fadeLayers: scope.fadeLayers, contentStopFrame: scope.contentStopFrame, data, expressionsOmitted, staleMetadata: metadata !== null && !consistent };
}

function normalizedVelocity(element: XmlElement, key: string, fallback: number): number {
	const value = numberAttribute(element, key) ?? fallback;
	if (value < 0 || value > 1) throw new RangeError(`DAWproject MIDI ${key} must be normalized.`);
	return Math.round(value * 127);
}

function sameNotePerformance(left: readonly MidiNote[], right: readonly MidiNote[]): boolean {
	return left.length === right.length && left.every((note, index) => {
		const other = right[index]!;
		return note.pitch === other.pitch && note.channel === other.channel && note.startFrame === other.startFrame
			&& note.durationFrames === other.durationFrames && note.velocity === other.velocity && note.releaseVelocity === other.releaseVelocity;
	});
}
