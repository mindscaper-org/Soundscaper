/* SPDX-License-Identifier: AGPL-3.0-only */
import { roundRational } from './timeline-time.ts';
import { normalizeMidiClipData, normalizeMidiTrackData, type MidiClipData, type MidiTrackData } from './midi-model.ts';

/** Schema-valid nameable comments retain information outside standard Notes vocabulary. */
const PREFIX = 'soundscaper.midi.v1:';
export function dawprojectMidiComment(value: unknown): string { return PREFIX + JSON.stringify(value); }

export function readDawprojectMidiTrackComment(comment: string | null | undefined): MidiTrackData | null {
	const value = readComment(comment);
	return value === null ? null : normalizeMidiTrackData(value);
}

export function readDawprojectMidiClipComment(comment: string | null, sampleRate: number): MidiClipData | null {
	const raw = readComment(comment);
	if (!raw || typeof raw !== 'object' || !('sampleRate' in raw) || !('data' in raw)) return null;
	const originalRate = raw.sampleRate;
	if (!Number.isSafeInteger(originalRate) || Number(originalRate) <= 0) throw new RangeError('Invalid MIDI metadata sample rate.');
	const data = normalizeMidiClipData(raw.data);
	const scale = (frame: number): number => roundRational(BigInt(frame) * BigInt(sampleRate), BigInt(Number(originalRate)), 'point');
	return normalizeMidiClipData({ ...data, notes: data.notes.map(note => ({ ...note,
		startFrame: scale(note.startFrame), durationFrames: Math.max(1, scale(note.startFrame + note.durationFrames) - scale(note.startFrame)),
		...(note.onsetStop ? { onsetStop: { ...note.onsetStop, frame: scale(note.onsetStop.frame),
			...(note.onsetStop.kind === 'all-notes-off' ? { soundEndFrame: note.onsetStop.soundEndFrame === null ? null : scale(note.onsetStop.soundEndFrame) } : {}) } } : {}),
	})), ...(data.interchange ? { interchange: { events: data.interchange.events.map(event => ({ ...event, frame: scale(event.frame) })),
		tempos: data.interchange.tempos.map(event => ({ ...event, frame: scale(event.frame) })),
		signatures: data.interchange.signatures.map(event => ({ ...event, frame: scale(event.frame) })) } } : {}) });
}

function readComment(comment: string | null | undefined): unknown {
	if (!comment?.startsWith(PREFIX)) return null;
	if (comment.length > 16 * 1024 * 1024) throw new RangeError('MIDI metadata comment exceeds the supported size.');
	return JSON.parse(comment.slice(PREFIX.length)) as unknown;
}
